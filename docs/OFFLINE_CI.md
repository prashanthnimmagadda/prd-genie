# Offline CI

PRD Genie uses a trusted-machine gate outside GitHub Actions as the source of truth for quality and security evidence. Every default step runs without contacting an external service.

## Complete gate

Install the exact lockfile and supported Playwright browsers once:

```bash
npm ci
npx playwright install chromium firefox webkit
```

Run the complete local gate:

```bash
npm run ci:offline
```

The gate runs the content and history guard, formatting, lint, strict TypeScript, coverage, production build, a cache-only dependency audit, license inventory, SBOM generation, and Chromium, Firefox, and WebKit end-to-end tests. It writes `reports/offline-ci.json`, `reports/test-coverage.json`, and `reports/browser-e2e.json`. The test report records exact file, suite, passed, failed, pending, and todo counts from Vitest's machine-readable result rather than inferring them from source declarations.

The cache-only audit proves what the local npm advisory cache knows. It does not prove that the advisory data is current. Run `npm run audit:record` with approved network access to record separate current production and full dependency results in `reports/dependency-audit.json`.

Run `npm run gate:node` once under Node.js 22 and once under Node.js 24. These quick exact-SHA gates write `reports/node-22.json` and `reports/node-24.json`. A completed manual browser and source review is recorded with `npm run accessibility:record`; the command validates an exact-SHA review input before writing `reports/accessibility-review.json`.

For a faster pre-commit check that omits browsers:

```bash
npm run ci:offline:quick
```

## Pull request evidence

Before merge, a maintainer records:

- Exact Git SHA and clean working-tree state.
- Node version, operating system, and architecture.
- `reports/offline-ci.json`.
- Separate browser, accessibility, Node 22, Node 24, and online dependency reports.
- Coverage summary.
- Dependency audit result.
- SBOM and license report hashes.
- Container smoke-test result when container files changed.
- Real provider evaluation when provider prompts, schemas, streams, or proposal application changed.

The generated reports are ignored by Git because they include timestamps and machine-specific evidence. Release artifacts include reviewed copies.

## GitHub Actions policy

Repository Actions remain disabled. Checked-in workflow definitions are manual-only and request self-hosted runners, so pushes and pull requests cannot start them. They are non-authoritative templates for a possible future isolated runner design, not part of the current CI path.

The trusted-machine command above is the only release source of truth and refuses to run in a GitHub Actions environment. Do not run untrusted pull-request code directly on a maintainer workstation. Review the change first, then validate it in a disposable, non-privileged environment. Enabling Actions or dispatching a workflow requires an explicit governance decision and must not create GitHub billing or expose persistent maintainer resources.

## Platform policy

The release owner runs the gate locally on available supported platforms. A recorded successful container build and smoke test verifies the Linux container runtime only. It does not verify a Linux desktop package. A recorded native Windows run is required before claiming Windows release verification; configured workflow labels are not execution evidence.

After the offline, model, and container reports exist for the same clean SHA, generate local-only provenance with `npm run provenance`. The report recursively hashes the complete built client and server, migrations, container inputs, coverage summary, SBOM, license inventory, and validation reports.

Public release uses two separate authorization stages because public provenance and the final checksum manifest do not exist when the validated local package is first reviewed.

First obtain a provenance-preparation authorization. It uses `schemaVersion: 2`, `approvalScope: "public-github-provenance-preparation"`, `authorized: true`, the exact Git SHA and intended tag, repository and product identity, rights confirmation, passing validation status, known limitations, unresolved issues, and the exact `artifacts` array from the local provenance report. This authorization permits only local tag and public-provenance preparation. It does not authorize a push, GitHub release, upload, or other public promotion. Create the annotated tag locally, then run `PRD_GENIE_SOURCE_VISIBILITY=public-github PRD_GENIE_PUBLIC_PROVENANCE_AUTHORIZATION_FILE=/absolute/path/to/preparation.json npm run provenance`. The generator rejects a dirty tree, mismatched SHA or tag, incomplete authorization, missing artifact, stale validation report, or changed artifact hash.

Next assemble and reproduce the finished public release directory. It must contain only the source archive, evidence archive, license inventory, public provenance, SBOM, and `SHA256SUMS.txt`. Present the exact commit, annotated tag object, and SHA-256 of all six finished files for a fresh public-promotion approval. That approval uses `schemaVersion: 2`, `approvalScope: "public-github-promotion"`, `approved: true`, `tagObjectSha`, the same identity, rights, validation, limitation, and issue fields, and a `releaseAssets` array that names and hashes every finished file including the checksum manifest. Verify it with `npm run release:verify-approval -- /absolute/final-release-directory /absolute/promotion-approval.json`. The verifier rejects a lightweight or mismatched tag, dirty tree, missing or extra asset, checksum mismatch, changed byte, or incomplete approval. Do not push, upload, publish, or otherwise promote until this final verifier passes.

Run `npm run container:record-smoke` while Apple Container is stopped. The automated harness starts the engine, builds the clean SHA with an OCI revision label, validates the image digest and Linux ARM64 platform, checks health and Host rejection, proves unprivileged Node PID 1, creates a synthetic project, verifies persistence after restart, measures and hashes the SIGTERM shutdown log, removes only its exact container, volumes, and image, and returns Apple Container to its stopped state. A failed observation aborts the report and still attempts exact-resource cleanup.

Changing the runner policy is a governance decision. It requires explicit maintainer approval and must not introduce GitHub Actions billing.
