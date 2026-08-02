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

The gate runs the content and history guard, formatting, lint, strict TypeScript, coverage, production build, a cache-only dependency audit, license inventory, SBOM generation, and Chromium, Firefox, and WebKit end-to-end tests. It writes `reports/offline-ci.json`.

The cache-only audit proves what the local npm advisory cache knows. It does not prove that the advisory data is current. A release owner may run a fresh `npm audit` separately only after authorizing disclosure of the dependency manifest to the npm advisory service, then record that result alongside the offline report.

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

## Non-authoritative GitHub workflow coverage

The checked-in workflow definitions request the labels `self-hosted` and `prd-genie`. Platform jobs also request their operating-system label. They do not select GitHub-hosted compute, but repository plan, artifact storage, and other GitHub services remain account-dependent. Repository settings currently keep Actions disabled; enabling them is a separate maintainer decision.

The trusted-machine command above is the release source of truth. It refuses to run when it detects a GitHub Actions environment. Untrusted pull-request code must never execute on a maintainer workstation or privileged self-hosted runner.

## Platform policy

The release owner runs the gate locally on available supported platforms. A recorded successful container build and smoke test verifies the Linux container runtime only. It does not verify a Linux desktop package. A recorded native Windows run is required before claiming Windows release verification; configured workflow labels are not execution evidence.

Changing the runner policy is a governance decision. It requires explicit maintainer approval and must not introduce GitHub Actions billing.
