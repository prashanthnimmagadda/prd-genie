# Threat model

## Protected assets

- Provider credentials.
- Confidential PRD content.
- Uploaded source documents.
- Extracted source text and embeddings.
- Citation and review history.
- Portable project archives and ChatGPT handoffs.

## Trust boundaries

- The local browser and local Node.js process.
- The operating system and filesystem.
- The selected external provider.
- Custom OpenAI-compatible endpoints.
- Local Ollama.
- Imported source documents.

## Primary threats and controls

### Credential disclosure

Credentials remain in a server memory store, use an opaque HttpOnly cookie, and are redacted from logs and errors. The application never echoes a key after configuration.

### Unintended outbound content

The provider disclosure names the outbound host and data classes. Actions send only the selected scope and retrieved excerpts.

### Prompt injection in sources

Source excerpts are labelled as untrusted evidence in system instructions. They are not interpreted as tool instructions. Human approval remains required for document changes.

### Malicious uploads

The server limits file size, checks supported extensions and file signatures, rejects encrypted PDFs, limits PDF pages and extracted text, and bounds DOCX entry count and declared expanded size. Portable restore rejects unsafe paths, unknown files, excessive entries, oversized streamed content, hash mismatches, and inconsistent references. Parsing libraries still process attacker-controlled formats, so only import files from sources you trust and keep dependencies updated.

### Handoff spoofing and replay

ChatGPT handoffs bind the project, source revision, section preimage hashes, evidence allowlist, and request digest. A response can be imported once, becomes stale after later document edits, and is staged for inspection before application. Users must inspect the selected outbound content and the returned patch.

### Remote network exposure

Native execution permits only loopback hosts. Containers require an explicit marker before wildcard binding, and Docker Compose publishes only on host loopback. Remote hosting is unsupported.

### Local device compromise

An attacker with access to the user account or unencrypted disk may read project data. This is a residual risk. Use full-disk encryption and a protected operating-system account.

## Non-goals

- Protection from a fully compromised operating system.
- Multi-user authorization.
- Remote tenant isolation.
- Provider-side retention guarantees.
- Independent encryption of local project data in v1.
