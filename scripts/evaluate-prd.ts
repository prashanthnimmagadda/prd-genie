import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { config } from '../src/server/config.js';
import type { EmbeddingService } from '../src/server/retrieval/embedding-service.js';

const model = process.env.PRD_GENIE_EVAL_MODEL ?? 'mistral:7b-instruct';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-model-eval-'));
const databasePath = path.join(directory, 'evaluation.sqlite');
const originalSourceDir = config.sourceDir;
Object.assign(config, { sourceDir: path.join(directory, 'sources') });

const lexicalEmbeddings = {
  getStatus: () => ({
    mode: 'lexical',
    model: 'evaluation',
    revision: 'none',
    detail: 'Semantic retrieval is intentionally disabled for this evaluation.',
  }),
  embed: () => Promise.reject(new Error('Lexical evaluation mode')),
  close: () => Promise.resolve(),
} as unknown as EmbeddingService;

let app: FastifyInstance | undefined;
try {
  const built = await buildApp({ databasePath, embeddings: lexicalEmbeddings });
  app = built.app;
  const session = await app.inject({ method: 'GET', url: '/api/session/providers' });
  const cookie = session.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
  const configured = await app.inject({
    method: 'PUT',
    url: '/api/session/providers/ollama',
    headers: { cookie },
    payload: { baseUrl: 'http://127.0.0.1:11434/v1' },
  });
  assertStatus(configured.statusCode, configured.body, 200, 'configure Ollama');
  const discovered = await app.inject({
    method: 'GET',
    url: '/api/providers/ollama/models',
    headers: { cookie },
  });
  assertStatus(discovered.statusCode, discovered.body, 200, 'discover models');
  const models = discovered.json<{ models: Array<{ id: string }> }>().models;
  if (!models.some((item) => item.id === model)) {
    throw new Error(`Evaluation model ${model} is not available.`);
  }

  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { name: 'Draft recovery evaluation', description: 'Synthetic evaluation fixture' },
  });
  assertStatus(created.statusCode, created.body, 201, 'create project');
  const project = created.json<{ id: string }>();
  const initial = (
    await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/prd`,
      headers: { cookie },
    })
  ).json<{
    revision: number;
    sections: Array<{ id: string; title: string; body: string; position: number }>;
  }>();
  const problem = initial.sections.find((section) => section.title === 'Problem');
  if (!problem) throw new Error('Problem section is missing.');
  problem.body = 'Product managers can lose work while drafting review documents.';
  const seeded = await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/prd`,
    headers: { cookie },
    payload: { revision: 0, sections: initial.sections, reason: 'Seed evaluation PRD' },
  });
  assertStatus(seeded.statusCode, seeded.body, 200, 'seed PRD');

  const sourceText = [
    '# Draft recovery research',
    '',
    'Twelve working product managers were interviewed in June 2026.',
    'Eight of the twelve participants lost unsaved PRD work during the previous 30 days.',
    'Those participants estimated a mean reconstruction time of 23 minutes per incident.',
    'The validated target user is a product manager preparing a document for stakeholder review.',
    'The approved success target is an 80 percent reduction in recovery-related work loss.',
    'A recovered draft must reopen within 10 seconds.',
    'The first release is a single-user local desktop workflow.',
    'No adoption volume or revenue impact has been validated.',
  ].join('\n');
  const uploaded = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/sources`,
    headers: {
      cookie,
      'content-type': 'multipart/form-data; boundary=evaluation-boundary',
    },
    payload: multipart('research.md', sourceText),
  });
  assertStatus(uploaded.statusCode, uploaded.body, 201, 'upload source');

  const draft = await runAction(app, cookie, {
    projectId: project.id,
    revision: 1,
    action: 'rewrite',
    scope: 'section',
    provider: 'ollama',
    model,
    targetSectionId: problem.id,
    instruction:
      'Rewrite the problem as a concise, evidence-grounded section. Include the observed frequency and reconstruction cost. Describe only the present user problem and its consequence. Exclude goals, success targets, solutions, release scope, and rollout. Use only validated evidence and omit unsupported business claims.',
  });
  const groundingChecks = {
    mentionsInterviewBase: /\b12|twelve\b/i.test(draft.text),
    mentionsObservedLoss: /\b8|eight\b/i.test(draft.text),
    mentionsReconstructionCost: /23\s+minutes?/i.test(draft.text),
    avoidsUnsupportedVolume:
      !/10[,\s]?000|ten thousand|revenue (?:increase|gain|growth|impact of)|market size (?:of|is)/i.test(
        draft.text,
      ),
    conciseProblem: draft.text.trim().length > 80 && draft.text.trim().length <= 1200,
    avoidsProcessNarration:
      !/\bwe (?:are|must|need|should)|\bsteps?:|final version:|the request asks|we are given/i.test(
        draft.text,
      ),
    avoidsOutOfScopeSolution:
      !/\b(?:our goal|goal is|success target|target is|reduce (?:recovery|this)|within 10 seconds|necessary to develop|the solution (?:will|must)|first release|initial focus|single-user local)\b/i.test(
        draft.text,
      ),
    returnsOnlyPrdContent: !/```|\bsection id\b|\bsource excerpt\b/im.test(draft.text.trim()),
    emitsCitation: draft.citations > 0,
    emitsCompletion: Boolean(draft.runId),
  };
  if (!draft.runId) throw new Error('Draft action did not emit a completion run ID.');
  const persistedRun = built.services.repository.getAiRun(project.id, draft.runId);
  if (persistedRun.status !== 'completed' || !persistedRun.outputText) {
    throw new Error(
      `Draft persistence failed: ${JSON.stringify({
        status: persistedRun.status,
        hasOutput: Boolean(persistedRun.outputText),
        streamCharacters: draft.text.length,
      })}`,
    );
  }
  const appliedDraft = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/ai-runs/${draft.runId}/apply`,
    headers: { cookie },
    payload: { revision: 1 },
  });
  assertStatus(appliedDraft.statusCode, appliedDraft.body, 200, 'apply grounded draft');
  const applied = appliedDraft.json<{
    revision: number;
    sections: Array<{ id: string; body: string }>;
  }>();
  const appliedProblem = applied.sections.find((section) => section.id === problem.id)?.body;
  groundingChecks.returnsOnlyPrdContent =
    groundingChecks.returnsOnlyPrdContent && !/^#{1,6}\s/m.test(appliedProblem ?? '');

  const review = await runAction(app, cookie, {
    projectId: project.id,
    revision: applied.revision,
    action: 'review',
    scope: 'document',
    provider: 'ollama',
    model,
    instruction:
      'Run the complete structured review. Prioritise empty requirements, measurable success criteria, risks, and unsupported assumptions.',
  });
  const findings = (
    await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/review-findings`,
      headers: { cookie },
    })
  ).json<{
    findings: Array<{
      targetSectionId: string;
      rationale: string;
      sourceRevision: number;
      citations: unknown[];
    }>;
  }>().findings;
  const knownSectionIds = new Set(initial.sections.map((section) => section.id));
  const reviewChecks = {
    emitsSummary: review.text.trim().length > 0,
    conciseReviewSummary: review.text.trim().length <= 1500,
    substantiveReviewSummary:
      review.text.trim().length >= 80 &&
      /requirement|measure|risk|evidence|assumption|clarity|empty|missing|test/i.test(review.text),
    avoidsReviewProcessNarration:
      !/\bwe (?:are|must|need|should)|the request asks|we are given/i.test(review.text),
    emitsFinding: findings.length > 0,
    targetsKnownSections: findings.every((finding) => knownSectionIds.has(finding.targetSectionId)),
    bindsRevision: findings.every((finding) => finding.sourceRevision === applied.revision),
    givesRationale: findings.every((finding) => finding.rationale.trim().length > 10),
  };

  await app.close();
  app = undefined;
  const restarted = await buildApp({ databasePath, embeddings: lexicalEmbeddings });
  app = restarted.app;
  const persisted = await app.inject({
    method: 'GET',
    url: `/api/projects/${project.id}/prd`,
  });
  assertStatus(persisted.statusCode, persisted.body, 200, 'read persisted PRD');
  const persistedPrd = persisted.json<{ revision: number; sections: Array<{ body: string }> }>();
  const persistenceChecks = {
    revisionPersisted: persistedPrd.revision === applied.revision,
    appliedTextPersisted: persistedPrd.sections.some((section) => section.body === appliedProblem),
  };

  const checks = { ...groundingChecks, ...reviewChecks, ...persistenceChecks };
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const report = {
    generatedAt: new Date().toISOString(),
    model,
    provider: 'ollama',
    retrievalMode: 'lexical',
    fixture: 'synthetic-draft-recovery',
    checks,
    score: { passed, total, percentage: Math.round((passed / total) * 100) },
    sample: {
      generatedProblem: draft.text.trim(),
      reviewSummary: review.text.trim(),
      findingCount: findings.length,
    },
    limitations: [
      'This is a deterministic rubric over one synthetic PRD scenario.',
      'It proves the real local provider path, not equal quality across all providers or prompts.',
      'Human review remains required before a PRD is treated as decision-ready.',
    ],
  };
  fs.mkdirSync(path.resolve('reports'), { recursive: true });
  fs.writeFileSync(
    path.resolve('reports/model-evaluation.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Model evaluation passed ${passed}/${total} checks.`);
  if (passed !== total) {
    console.error(JSON.stringify(checks, null, 2));
    process.exitCode = 1;
  }
} finally {
  if (app) await app.close();
  Object.assign(config, { sourceDir: originalSourceDir });
  fs.rmSync(directory, { recursive: true, force: true });
}

async function runAction(
  target: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<{ text: string; citations: number; runId: string | null }> {
  const response = await target.inject({
    method: 'POST',
    url: '/api/ai/actions',
    headers: { cookie },
    payload,
  });
  assertStatus(response.statusCode, response.body, 200, `run ${String(payload.action)}`);
  let text = '';
  let citations = 0;
  let runId: string | null = null;
  for (const line of response.body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === '[DONE]') continue;
    const part = JSON.parse(raw) as {
      type: string;
      delta?: string;
      errorText?: string;
      data?: { runId?: string };
    };
    if (part.type === 'text-delta') text += part.delta ?? '';
    if (part.type === 'data-citation') citations += 1;
    if (part.type === 'data-completion') runId = part.data?.runId ?? null;
    if (part.type === 'error') throw new Error(`AI stream failed: ${part.errorText}`);
  }
  return { text, citations, runId };
}

function assertStatus(actual: number, body: string, expected: number, operation: string): void {
  if (actual !== expected) {
    throw new Error(`${operation} returned HTTP ${actual}: ${body.slice(0, 1000)}`);
  }
}

function multipart(filename: string, content: string): Buffer {
  return Buffer.from(
    [
      '--evaluation-boundary',
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: text/markdown',
      '',
      content,
      '--evaluation-boundary--',
      '',
    ].join('\r\n'),
  );
}
