# ChatGPT integration

## What is supported

This repository contains a skills-only plugin at `plugins/prd-genie`. It is available only after a user installs it in a ChatGPT surface that supports plugins. Any ChatGPT usage is governed by that user’s ChatGPT plan, region, and workspace policy. It has no hosted connector, MCP server, app, hook, OAuth flow, or API-calling code.

The standalone PRD Genie application still connects to model providers through a separate API key or local Ollama. A ChatGPT subscription or ChatGPT sign-in does not provide API credentials, API credits, model tokens, or billing entitlement to the standalone application.

## Privacy boundary

The plugin runs in the ChatGPT conversation. Users must share only the PRD sections and evidence they are authorized to send to OpenAI. The standalone application does not receive ChatGPT cookies, account tokens, unrelated conversation history, billing data, or subscription details.

Exporting a handoff is an intentional disclosure to ChatGPT and OpenAI by the user. It is outside the standalone provider request path. The exported request and imported response are retained locally as handoff records until the user deletes the handoff or deletes the project.

The first integration is skills-only. It does not operate a remote PRD Genie service. An optional local MCP adapter may be considered later, but it will remain disabled by default and will stage proposals only.

## Safe handoff

The local application will export a narrow request containing:

- An opaque handoff and project identifier.
- The current PRD revision.
- Only the chosen sections and their preimage hashes.
- Only the chosen evidence excerpts and opaque evidence IDs.
- The requested action, scope, and instruction.

It will not include keys, cookies, source binaries, filesystem paths, environment data, logs, or unrelated project content.

ChatGPT returns a versioned response. The local app validates the handoff ID, request digest, project, revision, section allowlist, preimage hashes, evidence allowlist, size, and replay state. Imported output is staged as a proposal and is never silently applied.

Findings returned through a ChatGPT handoff remain inside that handoff record. They do not automatically enter the direct-provider review queue.

## Availability

Plugin installation and file-generation behavior can vary by ChatGPT plan, region, workspace policy, and surface. BYOK and Ollama remain available when the plugin is unavailable.

See [Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt) for the identity-only data boundary and [plugin architecture](https://developers.openai.com/plugins/concepts/plugins) for the current plugin model.
