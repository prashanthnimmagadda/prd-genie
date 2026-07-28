# Offline CI

PRD Genie uses self-hosted runners and does not require GitHub-hosted runner billing.

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

The gate runs the content and history guard, formatting, lint, strict TypeScript, coverage, production build, dependency audit, license inventory, SBOM generation, and Chromium, Firefox, and WebKit end-to-end tests. It writes `reports/offline-ci.json`.

For a faster pre-commit check that omits browsers:

```bash
npm run ci:offline:quick
```

## Pull request evidence

Before merge, a maintainer records:

- Exact Git SHA and clean working-tree state.
- Node version, operating system, and architecture.
- `reports/offline-ci.json`.
- Coverage summary.
- Dependency audit result.
- SBOM and license report hashes.
- Container smoke-test result when container files changed.
- Real provider evaluation when provider prompts, schemas, streams, or proposal application changed.

The generated reports are ignored by Git because they include timestamps and machine-specific evidence. Release artifacts include reviewed copies.

## Self-hosted workflow mirror

The automatic workflow definitions in `.github/workflows` require the labels `self-hosted` and `prd-genie`. Platform jobs also require their operating-system label. They cannot select a GitHub-hosted runner.

The local command above is the release source of truth. A self-hosted runner mirrors the same controls for pull requests, pushes, and scheduled security scans.

## Platform policy

The release owner runs the gate locally on available supported platforms. A container build verifies the Linux runtime. Windows path behavior is covered by unit tests, but an actual Windows run must be recorded before Windows is described as release-verified.

Changing the runner policy is a governance decision. It requires explicit maintainer approval and must not introduce GitHub Actions billing.
