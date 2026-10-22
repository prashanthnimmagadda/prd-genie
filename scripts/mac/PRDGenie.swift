import Cocoa
import Darwin
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow?
    private var server: Process?
    private var attempts = 0
    private var address: URL?

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
        process.standardOutput = log
        process.standardError = log
        do { try process.run() } catch { fail("The local PRD Genie server could not start: \(error.localizedDescription)"); return }
        self.server = process

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "PRD Genie"
        window.center()
        window.minSize = NSSize(width: 900, height: 650)
        let webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        waitForServer(webView)
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

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(disposition.lowercased().contains("attachment") ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        guard let window else { completionHandler(nil); return }
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if server?.isRunning == true { server?.terminate(); server?.waitUntilExit() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
