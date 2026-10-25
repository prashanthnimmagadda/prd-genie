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

`npm run eval:model` defaults to the real Ollama-compatible provider path with synthetic sources and PRDs. The release gate accepts that configuration or the explicitly approved Bonsai corpus configuration below, with every existing quality assertion retained. Both require the exact clean release commit and explicitly available local models. Missing runtime or model access blocks release evidence; it does not waive the gate or authorize starting services or installing models. A report is valid only when it records the exact drafting model, review model, both model digests, Git SHA, retrieval mode, scenario corpus, rubric results, citations, and generated samples.

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

The Bonsai evaluation uses the same five rewrite cases and the same structured
review containing adversarial evidence. The latter is one request with two sets
of assertions: six model requests in total. All prompts, cases, acceptance and
persistence assertions remain unchanged. The explicit corpus policy is 8,192
completion tokens, including up to 4,096 reasoning tokens. It is a different
generation configuration, not an equivalent mapping of application limits.

The application still requests 1,800 tokens for section rewrites and 6,000 for
a default 13-section review. Reviews of larger structures have a 9,000 ceiling.
This corpus does not verify that ceiling, selection rewrites, section-only
reviews, or direct Bonsai connection through the application's generic provider.
It does not establish Qwen results. No provider or billing fallback is permitted.

`PRD_GENIE_EVAL_PROVIDER=bonsai node --import tsx scripts/evaluate-prd.ts`
performs a read-only readiness check and exits 75 with a pending report. It
makes no provider request and does not overwrite the model-evaluation report.
The revision02 task/result schemas in `evaluations/bonsai-revision02/` and their
codec are pinned to the independently reviewed native contract. The retained
`evaluations/prd-corpus-v3.json` records the existing inputs and system prompts;
preflight refuses drift, and the evidence verifier binds receipts to these inputs
and their reported, normalized outputs.

Live execution additionally requires separate installation/execution authority,
a clean checkout, `PRD_GENIE_BONSAI_LIVE=1`, and
`PRD_GENIE_BONSAI_READINESS=/absolute/path/to/reviewed-readiness.json`. The readiness
file contains schema `prd-bonsai-readiness-v1`, the exact `contractSha256`, the
five native `sourceIdentity` pins (commit, tree, module, consumer record, public
wrapper), and the actual model artifact `modelDigest`. Staged source is not
installation evidence. Never invent these identities or supply credentials.
The fixed existing native launcher and shared participating slot perform fresh
admission; this repository does not install them or change their safeguards.

The evaluator retains the application's existing local prompt profile while
injecting an evaluation-only language model. Reports label the actual provider
`custom:bonsai-v2`, preserve the original requested allowance, and record the
complete dispatched generation settings, exact task bytes, receipt, native
identity and case/run association. Both application repair attempts and SDK
retries are disabled for this evaluation. Normal product behaviour is unchanged.
The release verifier requires every existing assertion plus six validated
terminal receipts at the exact clean repository commit. A readiness report or
receipt alone cannot pass that gate.

Dispatch preparation and results are flushed to a unique directory under
the system temporary directory at `prd-genie-bonsai-evidence/` before proceeding. The command prints the exact journal path; retain it with
the final evidence before clearing temporary storage. A stopped batch preserves its journal
and failure report without replacing the last completed model report. Native
responses are buffered, not streamed. INCOMPLETE, NOT_SENT, UNKNOWN, malformed
receipts and missing terminal evidence stop the batch without automatic retry.
UNKNOWN may arrive as JSON and EOF while its descriptor holder remains alive:
process exit is not required, the holder must not be killed for cleanup, and
local settlement does not prove provider cancellation. The existing shared slot
serializes participating workers; it is not universal exclusion against every
native model caller. No new concurrency framework is introduced.

## What this does not prove

A deterministic synthetic corpus is not a general model benchmark. Provider behavior, model capability, prompt wording, source quality, language, and context size all affect output. A passing rubric proves only the recorded scenarios and model. PRD Genie never treats model output as automatically correct. Users inspect citations and proposed changes before accepting them, and should review exported documents before using them for product decisions.
