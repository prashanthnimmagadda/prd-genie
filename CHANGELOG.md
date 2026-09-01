# Changelog

All notable changes will be documented in this file.

The project follows Semantic Versioning and uses Conventional Commits with automated release notes.

## Unreleased

## [0.1.0-rc.3] - 2026-09-01

### Added

- Portable archive format 3 with applied ChatGPT handoff provenance and format 2 restore compatibility.
- Exact-SHA browser, accessibility, Node 22, Node 24, and online dependency evidence reports.
- Automatic mode-0600 SQLite snapshots before migrations of an existing database.

### Fixed

- Made valid large source locations portable while removing duplicated chunk text from new manifests.
- Preserved exact selected and user-revised ChatGPT applications after archive restore and re-export.
- Made fresh-clone coverage independent of a prebuilt client bundle.
- Rejected private, mixed, redirected, and DNS-rebound custom provider destinations.
- Isolated untrusted PRD instructions and evidence inside one structured provider envelope.
- Rejected cross-project evidence lookups and repaired corrupt reused content-addressed binaries.
- Prevented synchronous provider construction failures from leaving orphaned AI runs.
- Added fault-injection proof for review, direct AI, and ChatGPT application transactions.
- Rejected structured-review summaries and rationales that are not traceable to the reviewed PRD or cited evidence.
- Replaced valid but stale pre-migration sidecars with a fresh current-database snapshot on every upgrade attempt.
- Prevented direct AI proposals from being applied after any cited source evidence is deleted.
- Pinned GitHub workflow actions and the Node container base to immutable identities.
- Corrected security reporting, archive retention, rollback, and release-evidence documentation.
- Required passage-specific anchors for review clauses and removed generic causal or normative support.
- Split public provenance preparation from final promotion approval so approval binds every finished release asset byte and the annotated tag object.

## [0.1.0-rc.2] - 2026-08-30

### Added

- Independent local-first PRD workbench foundation.
- Structured editor, revision model, source ingestion, retrieval, BYOK providers, review workflow, citations, and exports.
- Open-source project policies, security controls, and offline quality gates.
- Revision-bound AI proposals, server-side finding acceptance, persistent undo, and exact citation hydration.
- Keyless loopback-compatible providers, explicit session clearing, and export-first project deletion.
- Deterministic full-workflow browser fixtures and a real local-provider quality evaluation.
- Durable AI run history, citation snapshots, revision restore, and safe project archive restore.
- Revision-bound ChatGPT file handoffs and a skills-only plugin for supported ChatGPT surfaces.
- Bounded local-model evaluation setup with recorded evidence, citations, and prompt-injection checks.

### Fixed

- Prevented healthy provider streams from being cancelled during Fastify response handoff.
- Prevented one-click review from dispatching a stale action.
- Prevented bodyless DELETE requests from being rejected as empty JSON.
- Made the provider dialog usable in short viewports.
- Normalised unique section-title references from structured provider output.
- Preserved source provenance after deletion and rejected unsafe or inconsistent archive graphs.
- Made source indexing failures visible, retryable, and safe during shutdown.
- Ensured draft and rewrite previews exactly match the validated Markdown that is applied.
- Preserved repeated Markdown headings without indexing heading-only evidence chunks.
- Made the authoritative local CI gate fully offline and cache-only for advisory checks.
- Blocked DNS-rebinding hosts and non-loopback browser origins at the server boundary.
- Removed project source text from FTS and prevented late embedding writes after deletion.
- Protected unsaved editor changes across AI acceptance, undo, project changes, archive restore, and page reload.
- Limited proposal undo to the immediately applied revision and blocked revision-bound work during document mutations.
- Limited section-scoped provider prompts to the selected section metadata.
- Made ChatGPT handoff deletion remove its retained request and response payloads.
- Rejected portable archives with invalid typed state, divergent snapshots, or impossible AI revision provenance.
- Bound restored AI and review applications to their exact revision reason and resulting snapshot.
- Rejected duplicate section identities in editor saves and historical archive snapshots.
- Preserved review history after section deletion and cross-checked restored citation snapshots.
- Froze in-flight proposal controls and restored immutable proposal provenance from AI history.
- Kept proposal targets explicit when editor focus changes or a historical run is inspected.
- Made evidence deletion serialize with review creation and acceptance.
- Added durable, path-confined retry for source and project binary cleanup.
- Initialised fresh container volumes before dropping to the unprivileged application user.
- Required explicit approval when provenance records public GitHub promotion.
- Cancelled pending cleanup on matching uploads and tightened container signal handling.
- Expanded grounding evaluation for unsupported qualifiers and target recommendations.
- Bound public provenance to the clean SHA, release tag, full runtime tree, and validation bundle.
- Made all checked-in GitHub workflow templates manual-only while Actions remains disabled.
- Streamed durable citation identities so current AI evidence can be exported to ChatGPT without reloading.
- Cleared ChatGPT evidence selections across action, history, and project context changes.
- Marked exported and staged ChatGPT handoffs stale when selected source evidence is deleted.
- Made direct AI and ChatGPT handoff application markers atomic with their PRD revisions.
- Rejected undeclared root and nested fields in structured review output.
- Updated the production dependency graph to resolve current PDF parsing, URI handling, HTML sanitization, diagram rendering, and expansion advisories.
