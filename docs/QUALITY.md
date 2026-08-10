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

Results are release evidence only when they were produced from the exact documented Git SHA with a clean working tree. Counts and percentages from an earlier release candidate do not validate later uncommitted work. The release evidence bundle records the current test counts, coverage summary, browser matrix, dependency audit, license inventory, SBOM, container smoke test, and platform limitations.

## Real-model evaluation

`npm run eval:model` exercises the real Ollama-compatible provider path with synthetic sources and PRDs. It is an optional release gate that requires an explicitly installed local model. A report is valid only when it records the exact model, model digest when available, Git SHA, retrieval mode, scenario corpus, rubric results, citations, and generated samples.

Prepare the bounded evaluation model before the first run:

```bash
ollama pull qwen3:4b-instruct
npm run eval:model:setup
npm run eval:model
```

The setup command creates `prd-genie-qwen3-4b-instruct:latest` with an 8,192-token context. The upstream model advertises a much larger context window that can require impractical local memory. Override the base model, alias, or context with `PRD_GENIE_EVAL_BASE_MODEL`, `PRD_GENIE_EVAL_MODEL`, and `PRD_GENIE_EVAL_CONTEXT_TOKENS` when a recorded evaluation requires a different configuration.

- Required evidence facts and rejection of unsupported business claims.
- Concise PRD-only output without process narration.
- Correct section scope.
- Citation and completion events.
- Concrete structured review output.
- Stable section targeting and revision binding.
- Proposal application and restart persistence.

Coverage has a 90% per-module gate for retrieval, credential handling, provider normalization, source deletion, and proposal application. Proposal application includes both direct provider output in `proposal-service.ts` and review or ChatGPT patch acceptance in `patch-application.ts`.

The generated report is written to `reports/model-evaluation.json`. No current real-model pass is claimed until that command succeeds for the exact release candidate.

## What this does not prove

A deterministic synthetic corpus is not a general model benchmark. Provider behavior, model capability, prompt wording, source quality, language, and context size all affect output. A passing rubric proves only the recorded scenarios and model. PRD Genie never treats model output as automatically correct. Users inspect citations and proposed changes before accepting them, and should review exported documents before using them for product decisions.
