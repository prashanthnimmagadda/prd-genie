# Threat model

## Protected assets

- Provider credentials.
- Confidential PRD content.
- Uploaded source documents.
- Extracted source text and embeddings.
- Citation and review history.

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

The server limits file size, checks supported extensions and file signatures, rejects encrypted PDFs, and parses sources without executing embedded content.

### Remote network exposure

The application binds to loopback by default. Docker publishes only on host loopback. Remote hosting is unsupported.

### Local device compromise

An attacker with access to the user account or unencrypted disk may read project data. This is a residual risk. Use full-disk encryption and a protected operating-system account.

## Non-goals

- Protection from a fully compromised operating system.
- Multi-user authorization.
- Remote tenant isolation.
- Provider-side retention guarantees.
- Independent encryption of local project data in v1.
