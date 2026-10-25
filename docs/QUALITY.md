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

## Verification coverage

The dependency-integrated runtime is identified by commit [`092b4cf`](https://github.com/prashanthnimmagadda/prd-genie/commit/092b4cffb42fafe16470233fb5f37f8f72e94354). The following checks were recorded on 8 September 2026. Reports retain the exact checked-out SHA; subsequent documentation-only changes do not change the runtime.

| Execution target                         | Recorded checks                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native macOS ARM64, Node 24.15.0         | Full 12-step gate; 234 unit/integration tests; 30 production-browser tests across Chromium, Firefox, and WebKit; production restart and export smoke test                                               |
| Native macOS ARM64, Node 22.23.2         | Clean install in a separate checkout; all 11 Node-gate steps, including the same 234 tests and production build                                                                                         |
| Linux ARM64 image, Apple Container 1.0.0 | Dockerfile build with Node 22.23.2; health; loopback Host rejection; UID 1000 and Node PID 1; persistent data after restart; graceful SIGTERM; removal of exact temporary resources and engine shutdown |
| Dependency advisory data on 8 September  | Zero findings in both production and full npm audits at the recorded commit; generated license inventory and CycloneDX SBOM                                                                             |

An interim audit on 22 October 2026 at `40e3906` found three moderate
production findings and 23 findings in the full development tree. After the
dependency fixes, an online audit at `87c1538` recorded zero findings in both
scopes. The full offline release gate passed at `3b16e8c` on macOS. See the
[focused production triage](DEPENDENCY_TRIAGE.md). These recorded results do
not establish signed distribution or model quality.

Apple Container consumes the repository's Dockerfile and runs its Linux image. That execution does not exercise Docker Engine or Compose orchestration, native Windows, or a Linux desktop installation. Those are separate execution targets, not interchangeable names for the measured environment. The [README](../README.md#containers) includes the Apple Container commands as well as the Compose recipe.

The container smoke check starts with an empty model cache and no source document. Its initial `degraded` retrieval status means semantic indexing has not initialized; the smoke checks do not claim to evaluate retrieval quality. Source ingestion, citations, proposal acceptance, archive restore, and model behavior have their own browser and model checks.

Automated regression tests use explicitly labelled synthetic fixtures so expected outputs and adverse cases are reproducible without committing private product data. A real-product evaluation is separate evidence: it must record the actual requirements, source provenance, model, accepted and rejected proposals, exports, and reviewer findings. Generating a plausible PRD alone does not establish factual source evidence or customer validation.

## Real-product workflow

A private source-backed product case was exercised on 8 September 2026 at `4554cae`, before the URI lockfile correction. It used the compiled app, an isolated database, actual hybrid indexing, and the installed 4B Ollama drafting model. Twenty workflow assertions passed across import, source readiness, proposal staging, explicit acceptance, duplicate-apply rejection, Markdown/DOCX/PDF/archive export, archive restoration with handoff provenance, and restart persistence. The original source files and generated provider responses remain outside this public repository.

The 4B proposal preserved the original problem wording unchanged. Whole-document reviews from the 4B and 9B local models failed validation; diagnostic output included incorrect citation identifiers and statements contradicted by the document. Those responses were rejected and not applied. A separate source-grounded file handoff was imported as a staged proposal, explicitly accepted, and supplemented through an explicit editor save after source review. This did not test ChatGPT browser login or plugin installation and did not use ChatGPT credentials as an API key.

This case proves the recorded real-source workflow and rejection behavior, not reliable autonomous whole-document review by the tested local models. A valid handoff also remains subject to factual review before acceptance.

## Real-model evaluation

`npm run eval:model` exercises the real Ollama-compatible provider path with synthetic sources and PRDs. It is a required release gate for the exact clean release commit and requires explicitly installed local models. Missing runtime or model access blocks release evidence; it does not waive the gate or authorize starting services or installing models. A report is valid only when it records the exact drafting model, review model, both model digests, Git SHA, retrieval mode, scenario corpus, rubric results, citations, and generated samples.

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
- An adversarial structured-review case that proves raw retrieval contains a fixed hostile canary,
  while the provider-visible and durable citation sets exclude that chunk and generated review prose
  or patches do not repeat its instruction.
- Stable section targeting and revision binding.
- Proposal application and restart persistence.

Coverage has a 90% per-module gate for retrieval, credential handling, provider normalization, source deletion, and proposal application. Proposal application includes both direct provider output in `proposal-service.ts` and review or ChatGPT patch acceptance in `patch-application.ts`.

The generated report is written to `reports/model-evaluation.json`. No current real-model pass is claimed until that command succeeds for the exact release candidate.

### Shared Bonsai evaluation preparation

`PRD_GENIE_EVAL_PROVIDER=bonsai npm run eval:model` performs a local readiness
check and currently exits 75 with a pending report on stdout. It creates no
evaluation database, starts no provider or model process, makes no provider request and
does not overwrite `reports/model-evaluation.json`. All five existing rewrite
cases, structured/adversarial review and dependent persistence remain required.
There is no automatic Ollama or cloud fallback.

The revision02 task/result schemas are pinned under
`evaluations/bonsai-revision02/`. The evaluation-only codec in
`scripts/bonsai-evaluation.mjs` preserves messages, matches the native canonical
digest convention and validates completed receipts against an expected native
source identity. These are preparation checks, not live model-quality evidence.
The native entry is staged separately; this repository does not install it or
read its credentials. Process dispatch and shared-slot custody integration are
not enabled by the readiness command.

| Existing application limit | Use                                               | Bonsai revision02 status            |
| -------------------------- | ------------------------------------------------- | ----------------------------------- |
| 1,000                      | Selection rewrite                                 | No exact approved completion pair   |
| 1,800                      | Section rewrite, including all five corpus cases  | No exact approved completion pair   |
| 3,000                      | Section review                                    | No exact approved completion pair   |
| 6,000                      | Document draft/rewrite; default 13-section review | No exact approved completion pair   |
| Up to 9,000                | Review of larger structures                       | Exceeds the native maximum of 8,192 |

The native completion/reasoning pairs are 64/16, 256/32, 512/128, 1024/512,
1536/768, 2048/1024, 4095/3072, 4096/3072 and 8192/4096. Reasoning consumes part
of that allowance. No equivalent mapping is approved; selecting the closest
number would change the evaluation configuration. Native seed and sampling
settings also differ from the current evaluator. An explicit decision is needed
before enabling live corpus dispatch or accepting Bonsai release evidence.
The existing release verifier remains unchanged and does not accept a pending
readiness report as model evidence.

A completed native receipt alone would prove neither all PRD assertions nor
direct generic-provider compatibility. Only validated terminal completion plus
the unchanged corpus, explicit acceptance and persistence checks could establish
a release result. INCOMPLETE, NOT_SENT and UNKNOWN stop the batch. UNKNOWN can
arrive as bounded JSON and EOF while its descriptor holder remains alive;
process exit is not required to receive that outcome, and the holder must not be
terminated for cleanup or retried. Local settlement does not attest provider
cancellation. The participating shared slot does not exclude every native model
user, and this work makes no universal concurrency claim.

## What this does not prove

A deterministic synthetic corpus is not a general model benchmark. Provider behavior, model capability, prompt wording, source quality, language, and context size all affect output. A passing rubric proves only the recorded scenarios and model. PRD Genie never treats model output as automatically correct. Users inspect citations and proposed changes before accepting them, and should review exported documents before using them for product decisions.
