# Changelog

All notable changes will be documented in this file.

The project follows Semantic Versioning and uses Conventional Commits with automated release notes.

## Unreleased

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
- Protected unsaved editor changes when applying AI proposals and review findings.
- Limited section-scoped provider prompts to the selected section metadata.
- Made ChatGPT handoff deletion remove its retained request and response payloads.
- Rejected portable archives with invalid typed state or divergent revision history.
- Made all checked-in GitHub workflow templates manual-only while Actions remains disabled.
