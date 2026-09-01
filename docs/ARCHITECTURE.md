# Architecture

## Product boundary

PRD Genie is a single-user local browser application served from a local Node.js process. The default host is `127.0.0.1`. It is not currently a signed native desktop package. Remote deployment, account authentication, collaboration, and cloud sync are outside the v1 boundary.

## Package layout

- `src/client`: React, Tiptap, and the document workbench.
- `src/server`: Fastify routes, persistence, source processing, retrieval, providers, and exports.
- `src/shared`: runtime validation and public TypeScript contracts.
- `drizzle`: ordered SQLite migrations.
- `tests`: unit, integration, and browser-level contracts.

## Persistence

SQLite owns projects, PRD sections, revisions, sources, extracted locations, chunks, embeddings, AI runs, citations, review findings, and ChatGPT handoff records. Source binaries are stored by SHA-256 content hash outside SQLite.

Source and project deletion commits logical cleanup and an unreferenced-binary deletion job in one SQLite transaction. A path-confined worker drains those durable jobs after commit and at startup. Failed filesystem removals remain retryable without retaining live source records or exposing local paths through the API.

The persistence model assumes one server process owns an application data directory. Concurrent processes against the same SQLite database and source directory are unsupported. Rolling back to a binary that predates the deletion outbox leaves queued cleanup jobs untouched; upgrading again resumes cleanup.

Each PRD is an ordered list of stable-ID sections. A save creates a monotonically increasing project revision and an immutable JSON snapshot. AI findings and handoffs target a section ID and source revision. A later save marks open findings and outstanding handoffs stale.

Portable archive format version 3 contains project metadata, the current PRD, revision snapshots, source metadata and binaries, extracted locations, reconstructable chunk metadata, AI runs, durable citation snapshots, review findings, and applied ChatGPT handoffs. Exact application records retain the proposed and accepted text for RC.3 handoffs. Applied handoffs created before that record existed carry an explicit legacy-provenance limitation. Session credentials, embeddings, and unapplied ChatGPT handoffs are omitted. Restore accepts format version 2, validates paths, entry counts, expanded byte limits, hashes, reference integrity, and schema, then performs an atomic identifier-remapped insert and recomputes handoff digests. Embeddings are regenerated locally after restore.

Before applying pending SQLite migrations to an existing database, the server creates a mode-0600 snapshot beside the database with a `.pre-<migration>.backup` suffix. Keep that snapshot until the upgraded application and archives are verified. Rolling back application code after RC.3 data has been written requires restoring both the matching database backup and source directory backup; an older binary must not be treated as a schema downgrade tool.

## Retrieval

1. Parse source locations with page, heading, and character-offset metadata.
2. Chunk text below the embedding model token limit with a 40-token overlap.
3. Insert every chunk into FTS5.
4. Generate 384-dimensional embeddings in a worker thread when the pinned model is available.
5. Retrieve lexical and vector candidates separately.
6. Merge rankings with reciprocal-rank fusion.
7. Deduplicate and cap repeated excerpts from a single source.
8. Return no more than eight excerpts inside the action budget.

FTS5 remains available when semantic indexing is unavailable. Each source exposes processing, ready, or partial status. Background indexing is tracked during server shutdown and can be retried.

## Provider boundary

Provider credentials live only in a server memory map keyed by an opaque browser-session cookie. Environment variables are fallback inputs. The selected provider and model are safe project preferences and may be persisted.

Every AI run records provider, model, action, scope, project, source revision, and immutable section or selection target. Citations preserve source name, locator, and excerpt snapshots even if the local source is later deleted. Finding creation and acceptance revalidate citation ownership and availability inside the same SQLite transaction as the review state change. Direct AI and ChatGPT handoff applications commit the new PRD revision and application marker in one SQLite transaction. Generated text is a proposal until a user explicitly accepts it.

The ChatGPT path is a separate manual handoff, not provider API access. A handoff contains only user-selected sections and evidence. Imported responses are validated against the request digest, revision, section preimage hashes, evidence allowlist, and replay state, then staged for inspection. Deleting selected source evidence marks exported and staged handoffs stale while retaining their audit snapshots. Handoff findings remain in their separate handoff record rather than entering the direct-provider review queue.

## Security controls

- Loopback binding by default.
- HttpOnly, same-site browser-session cookie.
- Eight-hour idle session expiry.
- Schema validation at route boundaries.
- Upload size and file-signature validation.
- HTTPS or loopback HTTP for custom model endpoints.
- Public-address validation, DNS pinning, and redirect rejection for remote custom endpoints.
- Credential redaction in logs and errors.
- Content Security Policy with local scripts, styles, and fonts only.
- No telemetry.

See [Threat model](THREAT_MODEL.md) for residual risks.
