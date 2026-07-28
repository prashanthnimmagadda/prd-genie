# Quality and model evaluation

PRD Genie separates application correctness from model quality.

## Application evidence

The complete offline gate runs:

- Content and Git history guard.
- Formatting, lint, and strict TypeScript.
- Unit and integration tests with coverage thresholds.
- Production client and server builds.
- Dependency audit, license inventory, and CycloneDX SBOM generation.
- Chromium, Firefox, and WebKit end-to-end tests with axe checks.

The current candidate passes 88 unit and integration tests and 18 browser checks. Global coverage is 91.59 percent statements, 83.33 percent branches, 86.38 percent functions, and 92.96 percent lines. Provider modules exceed 91 percent branch coverage and retrieval modules exceed 93 percent branch coverage.

## Real-model evaluation

`npm run eval:model` exercises the real Ollama-compatible provider path with a synthetic source and PRD. The release evaluation used Llama 3.1 8B and passed 20 of 20 checks covering:

- Required evidence facts and rejection of unsupported business claims.
- Concise PRD-only output without process narration.
- Correct section scope.
- Citation and completion events.
- Concrete structured review output.
- Stable section targeting and revision binding.
- Proposal application and restart persistence.

The generated report is written to `reports/model-evaluation.json`.

## What this does not prove

One deterministic synthetic scenario is not a general model benchmark. Provider behavior, model capability, prompt wording, source quality, and context size all affect output. PRD Genie never treats model output as automatically correct. Users inspect citations and proposed changes before accepting them, and should review exported documents before using them for product decisions.
