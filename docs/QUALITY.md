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

`npm run eval:model` exercises the real Ollama-compatible provider path with synthetic sources and PRDs. It is an optional release gate that requires explicitly installed local models. A report is valid only when it records the exact drafting model, review model, both model digests, Git SHA, retrieval mode, scenario corpus, rubric results, citations, and generated samples.

Prepare the bounded evaluation model before the first run:

```bash
ollama pull qwen3:4b-instruct
npm run eval:model:setup
ollama pull qwen3.5:9b-q8_0
npm run eval:model:setup-review
PRD_GENIE_EVAL_REVIEW_MODEL=prd-genie-qwen3.5-9b-review:latest npm run eval:model
```

The setup commands create bounded 8,192-token aliases. The 4B instruct model is evaluated for drafting and section rewrites. The 9B model is evaluated for structured review because it follows that JSON contract more reliably, but it is not accepted as a substitute for the 4B model in the prompt-injection rewrite scenario. This is a recorded evaluation configuration, not automatic model routing in the product. Users choose the provider and model for each action.

The upstream models advertise much larger context windows that can require impractical local memory. Override the drafting model with `PRD_GENIE_EVAL_BASE_MODEL`, `PRD_GENIE_EVAL_MODEL`, and `PRD_GENIE_EVAL_CONTEXT_TOKENS`. Override the review model with `PRD_GENIE_EVAL_REVIEW_MODEL`.

- Required evidence facts and rejection of unsupported business claims.
- Concise PRD-only output without process narration.
- Correct section scope.
- Citation and completion events.
- Concrete structured review output grounded in available source citations or the exact PRD section state.
- Stable section targeting and revision binding.
- Proposal application and restart persistence.

Coverage has a 90% per-module gate for retrieval, credential handling, provider normalization, source deletion, and proposal application. Proposal application includes both direct provider output in `proposal-service.ts` and review or ChatGPT patch acceptance in `patch-application.ts`.

The generated report is written to `reports/model-evaluation.json`. No current real-model pass is claimed until that command succeeds for the exact release candidate.

## What this does not prove

A deterministic synthetic corpus is not a general model benchmark. Provider behavior, model capability, prompt wording, source quality, language, and context size all affect output. A passing rubric proves only the recorded scenarios and model. PRD Genie never treats model output as automatically correct. Users inspect citations and proposed changes before accepting them, and should review exported documents before using them for product decisions.
