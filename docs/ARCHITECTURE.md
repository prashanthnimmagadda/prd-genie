# Architecture

## Product boundary

PRD Genie is a single-user desktop-browser application served from a local Node.js process. The default host is `127.0.0.1`. Remote deployment, account authentication, collaboration, and cloud sync are outside the v1 boundary.

## Package layout

- `src/client`: React, Tiptap, and the document workbench.
- `src/server`: Fastify routes, persistence, source processing, retrieval, providers, and exports.
- `src/shared`: runtime validation and public TypeScript contracts.
- `drizzle`: ordered SQLite migrations.
- `tests`: unit, integration, and browser-level contracts.

## Persistence

SQLite owns projects, PRD sections, revisions, sources, extracted locations, chunks, embeddings, AI runs, citations, and review findings. Source binaries are stored by SHA-256 content hash outside SQLite.

Each PRD is an ordered list of stable-ID sections. A save creates a monotonically increasing project revision and an immutable JSON snapshot. AI findings target a section ID and source revision. A later save marks open findings stale.

## Retrieval

1. Parse source locations with page, heading, and character-offset metadata.
2. Chunk text below the embedding model token limit with a 40-token overlap.
3. Insert every chunk into FTS5.
4. Generate 384-dimensional embeddings in a worker thread when the pinned model is available.
5. Retrieve lexical and vector candidates separately.
6. Merge rankings with reciprocal-rank fusion.
7. Deduplicate and cap repeated excerpts from a single source.
8. Return no more than eight excerpts inside the action budget.

FTS5 remains available when semantic indexing is unavailable.

## Provider boundary

Provider credentials live only in a server memory map keyed by an opaque browser-session cookie. Environment variables are fallback inputs. The selected provider and model are safe project preferences and may be persisted.

Every AI run records provider, model, action, scope, project, and source revision. Citations point to stable source, location, and chunk records. Generated text is a proposal until a user explicitly accepts it.

## Security controls

- Loopback binding by default.
- HttpOnly, same-site browser-session cookie.
- Eight-hour idle session expiry.
- Schema validation at route boundaries.
- Upload size and file-signature validation.
- HTTPS or loopback HTTP for custom model endpoints.
- Credential redaction in logs and errors.
- Content Security Policy with local scripts, styles, and fonts only.
- No telemetry.

See [Threat model](THREAT_MODEL.md) for residual risks.
