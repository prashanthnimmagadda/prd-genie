import Cocoa
import Darwin
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, NSToolbarDelegate, NSMenuItemValidation, NSToolbarItemValidation {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var server: Process?
    private var attempts = 0
    private var address: URL?
    private var contentReady = false
    private var hasProject = false
    private var dirty = false
    private var busy = false
    private var recoveryPending = false
    private var modalOpen = false
    private var discardConfirmed = false
    private var accessibilityObserver: NSObjectProtocol?
    private let commands: Set<String> = ["toggle-sidebar", "conversation", "document", "sources", "history", "export", "settings", "save", "new-project"]

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let resource = Bundle.main.resourceURL else { fail("The application resources are missing."); return }
        let root = resource.appendingPathComponent("app", isDirectory: true)
        let node = resource.appendingPathComponent("node", isDirectory: false)
        let port = availablePort()
        let address = URL(string: "http://127.0.0.1:\(port)/")!
        self.address = address

        let process = Process()
        process.executableURL = node
        process.arguments = ["dist/server/server/index.js"]
        process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment["PRD_GENIE_HOST"] = "127.0.0.1"
        environment["PRD_GENIE_PORT"] = String(port)
        environment["NODE_ENV"] = "production"
        environment["PRD_GENIE_OCR_HELPER"] = resource.appendingPathComponent("jpeg-ocr").path
        process.environment = environment
        let log = Pipe()
        // Drain local server output without retaining request URLs or document data.
        // An unread pipe can fill and stall the server during a longer session.
        log.fileHandleForReading.readabilityHandler = { handle in
            if handle.availableData.isEmpty { handle.readabilityHandler = nil }
        }
        process.standardOutput = log
        process.standardError = log
        do { try process.run() } catch { fail("The local PRD Genie server could not start: \(error.localizedDescription)"); return }
        self.server = process

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "PRD Genie"
        window.delegate = self
        window.appearance = NSAppearance(named: .aqua)
        window.subtitle = "Opening your local workspace"
        if !window.setFrameUsingName("PRDGenieWorkspace") { window.center() }
        window.setFrameAutosaveName("PRDGenieWorkspace")
        window.minSize = NSSize(width: 900, height: 650)
        window.toolbarStyle = .unified
        let toolbar = NSToolbar(identifier: "PRDGenieWorkspace")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "prdShell")
        configuration.userContentController.addUserScript(WKUserScript(source: nativeEnvironmentScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView
        self.webView = webView
        installMenus()
        accessibilityObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, let url = self.webView?.url, self.isAppURL(url) else { return }
            self.webView?.evaluateJavaScript(self.nativeEnvironmentScript(), completionHandler: nil)
        }
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        waitForServer(webView)
    }

    // React owns project state; this bridge only supplies window chrome and commands.
    private func nativeEnvironmentScript() -> String {
        guard let address, let host = address.host, let port = address.port else { return "" }
        let preferences = NSWorkspace.shared
        return """
        (() => {
          if (location.origin !== 'http://\(host):\(port)') return;
          window.__PRD_NATIVE__ = true;
          const preferences = {
            reduceMotion: \(preferences.accessibilityDisplayShouldReduceMotion),
            reduceTransparency: \(preferences.accessibilityDisplayShouldReduceTransparency),
            increaseContrast: \(preferences.accessibilityDisplayShouldIncreaseContrast)
          };
          window.__PRD_ACCESSIBILITY__ = preferences;
          const apply = () => {
            const root = document.documentElement;
            root.dataset.native = 'true';
            root.dataset.reduceMotion = String(preferences.reduceMotion);
            root.dataset.reduceTransparency = String(preferences.reduceTransparency);
            root.dataset.increaseContrast = String(preferences.increaseContrast);
            window.dispatchEvent(new CustomEvent('prd-accessibility', { detail: preferences }));
          };
          if (document.documentElement) apply();
          else document.addEventListener('DOMContentLoaded', apply, { once: true });
        })();
        """
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "prdShell", message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, isAppURL(url),
              let address, message.frameInfo.securityOrigin.protocol == address.scheme,
              message.frameInfo.securityOrigin.host == address.host,
              message.frameInfo.securityOrigin.port == address.port,
              let state = message.body as? [String: Any],
              let title = state["title"] as? String,
              let subtitle = state["subtitle"] as? String,
              let dirty = state["dirty"] as? Bool,
              let hasProject = state["hasProject"] as? Bool else { return }
        self.contentReady = true
        self.hasProject = hasProject
        self.dirty = dirty
        self.busy = state["busy"] as? Bool ?? false
        self.recoveryPending = state["recoveryPending"] as? Bool ?? false
        self.modalOpen = state["modalOpen"] as? Bool ?? false
        window?.title = displayText(title, limit: 120).isEmpty ? "PRD Genie" : displayText(title, limit: 120)
        window?.subtitle = displayText(subtitle, limit: 160)
        window?.isDocumentEdited = dirty
        window?.toolbar?.validateVisibleItems()
        // AppKit does not consistently propagate item validation to a custom view.
        // Keep the labelled Export button in sync with the same command policy.
        for item in window?.toolbar?.items ?? [] where commands.contains(item.itemIdentifier.rawValue) {
            let enabled = commandEnabled(item.itemIdentifier.rawValue)
            item.isEnabled = enabled
            (item.view as? NSButton)?.isEnabled = enabled
        }
    }

    private func displayText(_ value: String, limit: Int) -> String {
        String(value.filter { !$0.isNewline && !$0.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) }.prefix(limit))
    }

    @objc private func performCommand(_ sender: Any?) {
        let command: String?
        if let item = sender as? NSMenuItem { command = item.representedObject as? String }
        else if let item = sender as? NSToolbarItem { command = item.itemIdentifier.rawValue }
        else if let button = sender as? NSButton { command = button.identifier?.rawValue }
        else { command = nil }
        guard let command, commands.contains(command), commandEnabled(command),
              let url = webView?.url, isAppURL(url) else { return }
        // Only the fixed allowlist above reaches this JavaScript string.
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('prd-command', { detail: '\(command)' }));", completionHandler: nil)
    }

    private func commandEnabled(_ command: String) -> Bool {
        guard contentReady, !modalOpen else { return false }
        if command == "settings" || command == "new-project" { return true }
        if command == "save" { return hasProject && dirty }
        return hasProject
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard menuItem.action == #selector(performCommand(_:)), let command = menuItem.representedObject as? String else { return true }
        return commandEnabled(command)
    }

    func validateToolbarItem(_ item: NSToolbarItem) -> Bool {
        let enabled = commandEnabled(item.itemIdentifier.rawValue)
        (item.view as? NSButton)?.isEnabled = enabled
        return enabled
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.init("toggle-sidebar"), .flexibleSpace, .init("conversation"), .init("document"), .space, .init("sources"), .init("history"), .space, .init("export")]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(toolbar) }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let descriptions: [String: (String, String)] = [
            "toggle-sidebar": ("Projects", "sidebar.left"),
            "conversation": ("Conversation", "bubble.left.and.bubble.right"),
            "document": ("Document", "doc.text"),
            "sources": ("Sources", "paperclip"),
            "history": ("History", "clock.arrow.circlepath"),
            "export": ("Export", "square.and.arrow.up")
        ]
        guard let (title, symbol) = descriptions[identifier.rawValue] else { return nil }
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = title
        item.paletteLabel = title
        item.toolTip = title
        item.target = self
        item.action = #selector(performCommand(_:))
        if identifier.rawValue == "export" {
            let button = NSButton(title: "Export", target: self, action: #selector(performCommand(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(identifier.rawValue)
            button.bezelStyle = .texturedRounded
            button.isEnabled = false
            item.view = button
        } else {
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
        }
        item.isEnabled = commandEnabled(identifier.rawValue)
        return item
    }

    private func installMenus() {
        let bar = NSMenu()
        func menu(_ title: String) -> NSMenu {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let menu = NSMenu(title: title)
            item.submenu = menu
            bar.addItem(item)
            return menu
        }
        func command(_ menu: NSMenu, _ title: String, _ name: String, _ key: String = "", modifiers: NSEvent.ModifierFlags = .command) {
            let item = menu.addItem(withTitle: title, action: #selector(performCommand(_:)), keyEquivalent: key)
            item.target = self
            item.representedObject = name
            item.keyEquivalentModifierMask = modifiers
        }
        let application = menu("PRD Genie")
        application.addItem(withTitle: "About PRD Genie", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        application.addItem(.separator())
        command(application, "AI Settings…", "settings", ",")
        application.addItem(.separator())
        let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        services.submenu = NSMenu(title: "Services")
        application.addItem(services)
        NSApp.servicesMenu = services.submenu
        application.addItem(.separator())
        application.addItem(withTitle: "Hide PRD Genie", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = application.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        application.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        application.addItem(.separator())
        application.addItem(withTitle: "Quit PRD Genie", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = menu("File")
        command(file, "New Project…", "new-project", "n")
        command(file, "Save", "save", "s")
        command(file, "Export…", "export", "e", modifiers: [.command, .shift])
        file.addItem(.separator())
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let edit = menu("Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let view = menu("View")
        command(view, "Toggle Projects Sidebar", "toggle-sidebar", "s", modifiers: [.command, .control])
        command(view, "Conversation", "conversation", "1")
        command(view, "Document", "document", "2")
        command(view, "Sources", "sources", "3")
        command(view, "History", "history", "4")
        view.addItem(.separator())
        let fullscreen = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.control, .command]
        let windows = menu("Window")
        windows.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windows.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windows.addItem(.separator())
        windows.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windows
        NSApp.mainMenu = bar
    }

    private func waitForServer(_ webView: WKWebView) {
        guard let address else { return }
        if server?.isRunning != true { fail("The local server stopped during startup. Check the app package and try again."); return }
        URLSession.shared.dataTask(with: address) { _, response, _ in
            DispatchQueue.main.async {
                if let response = response as? HTTPURLResponse, response.statusCode == 200 {
                    webView.load(URLRequest(url: address))
                } else if self.attempts < 60 {
                    self.attempts += 1
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer(webView) }
                } else {
                    self.fail("PRD Genie did not finish starting. Close the app and try again.")
                }
            }
        }.resume()
    }

    private func availablePort() -> Int {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        defer { close(descriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr = in_addr(s_addr: in_addr_t(0x0100007f))
        address.sin_port = 0
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        if bound != 0 { return Int.random(in: 40000...60000) }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(descriptor, $0, &length) }
        }
        return Int(UInt16(bigEndian: address.sin_port))
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "PRD Genie could not open"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func isAppURL(_ url: URL) -> Bool {
        guard let address else { return false }
        return url.scheme == address.scheme && url.host == address.host && url.port == address.port
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "blob" {
            let frame = navigationAction.sourceFrame
            guard navigationAction.shouldPerformDownload,
                  frame.isMainFrame, navigationAction.targetFrame?.isMainFrame != false,
                  let address, let sourceURL = frame.request.url, isAppURL(sourceURL),
                  let currentURL = webView.url, isAppURL(currentURL),
                  frame.securityOrigin.protocol == address.scheme,
                  frame.securityOrigin.host == address.host,
                  frame.securityOrigin.port == address.port,
                  let blobOriginURL = URL(string: String(url.absoluteString.dropFirst("blob:".count))),
                  isAppURL(blobOriginURL) else { decisionHandler(.cancel); return }
            decisionHandler(.download)
            return
        }
        if isAppURL(url) || url.scheme == "about" { decisionHandler(.allow); return }
        if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let url = frame.request.url, isAppURL(url), let window else { completionHandler(); return }
        let alert = NSAlert()
        alert.messageText = "PRD Genie"
        alert.informativeText = String(message.prefix(2000))
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let url = frame.request.url, isAppURL(url), let window else { completionHandler(false); return }
        let alert = NSAlert()
        alert.messageText = "Confirm action"
        alert.informativeText = String(message.prefix(2000))
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard let url = frame.request.url, isAppURL(url), let window else { completionHandler(nil); return }
        let alert = NSAlert()
        alert.messageText = String(prompt.prefix(200))
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        field.setAccessibilityLabel(String(prompt.prefix(200)))
        alert.accessoryView = field
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(disposition.lowercased().contains("attachment") ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        guard let window else { completionHandler(nil); return }
        panel.beginSheetModal(for: window) { result in
            if result != .OK { self.reportDownload("cancelled") }
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) { reportDownload("completed") }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if (error as NSError).code != NSURLErrorCancelled { reportDownload("failed") }
    }

    private func reportDownload(_ status: String) {
        guard ["completed", "cancelled", "failed"].contains(status), let url = webView?.url, isAppURL(url) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('prd-download', { detail: { status: '\(status)' } }));", completionHandler: nil)
    }

    private func mayCloseWorkspace(quitting: Bool) -> Bool {
        guard !discardConfirmed, dirty || busy || recoveryPending else { return true }
        let alert = NSAlert()
        alert.messageText = recoveryPending ? "Workspace changes are not saved yet" : (dirty ? "Keep your unsaved changes?" : "An AI request is still running")
        var explanation: [String] = []
        if recoveryPending { explanation.append("Your latest workspace changes have not finished saving locally. Keep this window open or close without saving.") }
        else if dirty { explanation.append("Return to the workspace to save your document before closing.") }
        if busy { explanation.append("Closing will stop the running request.") }
        alert.informativeText = explanation.joined(separator: " ")
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Keep Open")
        let closeTitle = dirty || recoveryPending ? (quitting ? "Quit Without Saving" : "Close Without Saving") : (quitting ? "Stop and Quit" : "Stop and Close")
        alert.addButton(withTitle: closeTitle).hasDestructiveAction = true
        let shouldClose = alert.runModal() == .alertSecondButtonReturn
        discardConfirmed = shouldClose
        return shouldClose
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { mayCloseWorkspace(quitting: false) }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        mayCloseWorkspace(quitting: true) ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let accessibilityObserver { NSWorkspace.shared.notificationCenter.removeObserver(accessibilityObserver) }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "prdShell")
        if server?.isRunning == true { server?.terminate(); server?.waitUntilExit() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
