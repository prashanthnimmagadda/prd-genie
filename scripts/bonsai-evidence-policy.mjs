import fs from 'node:fs';
import { URL } from 'node:url';
import {
  bonsaiEvaluationPolicy,
  canonicalJson,
  decodeBonsaiResult,
  encodeBonsaiTask,
} from './bonsai-evaluation.mjs';

const corpus = JSON.parse(
  fs.readFileSync(new URL('../evaluations/prd-corpus-v3.json', import.meta.url), 'utf8'),
);
const instructions = Object.fromEntries([
  ...corpus.cases.map((scenario) => [scenario.id, scenario.instruction]),
  ['structured-review', corpus.reviewInstruction],
]);

export function validBonsaiEvidence(model) {
  try {
    const evidence = model.bonsai;
    const identity = evidence?.sourceIdentity;
    const expectedCases = Object.keys(instructions);
    if (
      model.provider !== 'custom:bonsai-v2' ||
      model.model !== 'Ternary-Bonsai-2-27B-PQ2_0' ||
      model.reviewModel !== model.model ||
      !/^[a-f0-9]{64}$/.test(evidence?.modelDigest ?? '') ||
      model.modelDigest !== evidence.modelDigest ||
      model.reviewModelDigest !== evidence.modelDigest ||
      canonicalJson(evidence.policy) !== canonicalJson(bonsaiEvaluationPolicy) ||
      !identity ||
      !/^[a-f0-9]{40}$/.test(identity.commit ?? '') ||
      !/^[a-f0-9]{40}$/.test(identity.tree ?? '') ||
      !['module_sha256', 'consumer_record_sha256', 'public_wrapper_sha256'].every((key) =>
        /^[a-f0-9]{64}$/.test(identity[key] ?? ''),
      ) ||
      !Array.isArray(evidence.records) ||
      evidence.records.length !== expectedCases.length
    ) {
      return false;
    }
    const taskIds = new Set();
    const requestIds = new Set();
    const runIds = new Set();
    const apiRequestIds = new Set();
    let generation;
    for (const [index, caseId] of expectedCases.entries()) {
      const record = evidence.records[index];
      const review = caseId === 'structured-review';
      const associated = review
        ? model.structuredReview
        : model.scenarios.find((scenario) => scenario.id === caseId);
      if (
        record.caseId !== caseId ||
        record.originalMaxOutputTokens !== (review ? 6000 : 1800) ||
        (record.status !== undefined && record.status !== 'COMPLETED') ||
        typeof record.runId !== 'string' ||
        !record.runId ||
        associated?.runId !== record.runId ||
        runIds.has(record.runId) ||
        typeof record.taskJson !== 'string'
      ) {
        return false;
      }
      const task = JSON.parse(record.taskJson);
      const body = task.body;
      const encoded = encodeBonsaiTask({
        taskId: task.task_id,
        requestId: task.request_id,
        messages: body.messages,
        maxTokens: bonsaiEvaluationPolicy.maxTokens,
        reasoningTokens: bonsaiEvaluationPolicy.reasoningTokens,
      });
      // Exact canonical bytes also reject duplicate keys or unapproved sampling.
      if (
        encoded.bytes.toString('utf8') !== record.taskJson ||
        taskIds.has(task.task_id) ||
        requestIds.has(task.request_id) ||
        body.messages.length !== 2 ||
        body.messages[0].role !== 'system' ||
        body.messages[1].role !== 'user'
      ) {
        return false;
      }
      const prompt = body.messages[1].content;
      const taskData = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
      const scenario = corpus.cases.find((item) => item.id === caseId);
      if (
        taskData.formatVersion !== 2 ||
        taskData.qualitySpecVersion !== corpus.qualitySpecVersion ||
        prompt.slice(0, prompt.indexOf('\n')) !== corpus.taskPrefix ||
        taskData.action !== (review ? 'review' : 'rewrite') ||
        taskData.scope !== (review ? 'document' : 'section') ||
        taskData.userInstruction !== instructions[caseId] ||
        !Array.isArray(taskData.currentDocument?.sections) ||
        taskData.currentDocument.sections.length !== (review ? 13 : 1) ||
        !Array.isArray(taskData.evidence) ||
        !bindCorpusInput(taskData, body.messages, scenario, review, model)
      ) {
        return false;
      }
      const decoded = decodeBonsaiResult(
        Buffer.from(JSON.stringify(record.result)),
        encoded,
        identity,
      );
      if (
        !decoded.usable ||
        decoded.stopBatch ||
        apiRequestIds.has(decoded.result.api_request_id) ||
        (generation && generation !== decoded.result.generation)
      ) {
        return false;
      }
      if (
        review
          ? !bindReviewOutput(decoded.result.response.content, taskData, model)
          : sectionOutput(decoded.result.response.content, scenario.targetSection) !==
            associated.generatedText
      )
        return false;
      generation = decoded.result.generation;
      taskIds.add(task.task_id);
      requestIds.add(task.request_id);
      runIds.add(record.runId);
      apiRequestIds.add(decoded.result.api_request_id);
    }
    return true;
  } catch {
    return false;
  }
}

function summary(value) {
  return value
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

function sectionOutput(raw, title) {
  const text = raw.trim();
  const match = text.match(/^#{1,2}[ \t]+([^\n]+)\n+/);
  if (!match) return text;
  const normalize = (value) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s&-]/gu, '')
      .replace(/\s+/g, ' ');
  const heading = normalize(match[1]);
  const target = normalize(title);
  if (
    heading !== target &&
    !target
      .split(/\s+(?:and|&)\s+/)
      .filter((part) => part.length >= 4)
      .includes(heading)
  )
    return null;
  return text.slice(match[0].length).trim();
}

function bindReviewOutput(raw, taskData, model) {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const output = JSON.parse(fence ? fence[1].trim() : trimmed);
  if (
    typeof output.summary !== 'string' ||
    !Array.isArray(output.findings) ||
    output.findings.length === 0 ||
    output.findings.length > 20
  )
    return false;
  const sections = taskData.currentDocument.sections;
  const findings = output.findings.map((finding) => {
    const section =
      sections.find((candidate) => candidate.id === finding.targetSectionId) ??
      sections.find(
        (candidate) =>
          candidate.title.trim().toLowerCase() === finding.targetSectionId.trim().toLowerCase(),
      );
    if (
      !section ||
      !Array.isArray(finding.citationChunkIds) ||
      finding.citationChunkIds.some((id) => !taskData.allowedCitationChunkIds.includes(id))
    )
      throw new Error('Invalid review reference.');
    return { finding, section };
  });
  const allEmpty = findings.every(({ section }) => !section.body.trim());
  const normalized = findings.map(({ finding, section }) => ({
    targetSectionId: section.id,
    rationale: allEmpty ? `The ${section.title} section is empty.` : finding.rationale,
    proposedMarkdown: allEmpty ? null : finding.proposedMarkdown,
  }));
  const expectedSummary = summary(
    allEmpty ? normalized.map((finding) => finding.rationale).join(' ') : output.summary,
  );
  if (
    model.structuredReview.summary !== expectedSummary ||
    model.structuredReview.findingCount !== normalized.length ||
    model.structuredReview.findings?.length !== normalized.length
  )
    return false;
  const stored = model.structuredReview.findings;
  if (
    normalized.some(
      (finding, index) =>
        stored[index].targetSectionId !== finding.targetSectionId ||
        stored[index].rationale !== finding.rationale ||
        (stored[index].proposedMarkdown !== null &&
          stored[index].proposedMarkdown !== finding.proposedMarkdown),
    )
  )
    return false;
  // The app can reject an unsafe proposed patch. It cannot invent a replacement.
  return (
    canonicalJson(model.adversarialStructuredReview.output) ===
    canonicalJson({
      summary: expectedSummary,
      rationales: stored.map((finding) => finding.rationale),
      proposedMarkdown: stored.map((finding) => finding.proposedMarkdown),
    })
  );
}

function bindCorpusInput(taskData, messages, scenario, review, model) {
  const expectedSections = review
    ? corpus.defaultSections
    : corpus.defaultSections.filter((section) => section.title === scenario.targetSection);
  const sections = taskData.currentDocument.sections;
  if (
    messages[0].content !== corpus.systemPrompts[review ? 'review' : 'rewrite'] ||
    taskData.projectContext?.name !== `Evaluation ${review ? 'grounded-problem' : scenario.id}` ||
    taskData.projectContext.description !== 'Synthetic evaluation fixture' ||
    taskData.currentDocument.revision !== (review ? 2 : 1) ||
    sections.length !== expectedSections.length
  )
    return false;
  const groundedOutput = model.scenarios.find(
    (item) => item.id === 'grounded-problem',
  )?.generatedText;
  if (
    sections.some(
      (section, index) =>
        !section.id ||
        section.title !== expectedSections[index].title ||
        section.body !==
          (review ? (section.title === 'Problem' ? groundedOutput : '') : scenario.initialBody),
    )
  )
    return false;
  if (
    new Set(sections.map((section) => section.id)).size !== sections.length ||
    taskData.scopedPrdContent !==
      sections.map((section) => `## ${section.title}\n${section.body}`).join('\n\n')
  )
    return false;
  if (
    canonicalJson(taskData.sections) !==
      canonicalJson(sections.map(({ id, title }) => ({ id, title }))) ||
    canonicalJson(taskData.selectedStructure) !==
      canonicalJson(
        sections.map(({ id, title }, index) => ({
          id,
          title,
          purpose: expectedSections[index].purpose,
          required: expectedSections[index].required,
        })),
      )
  )
    return false;
  const source = review ? corpus.cases[0] : scenario;
  if (
    (!review && taskData.evidence.length === 0) ||
    taskData.evidence.some(
      (item) =>
        typeof item.excerpt !== 'string' ||
        !item.excerpt.trim() ||
        !(
          (item.sourceName === `${source.id}.md` && source.sourceText.includes(item.excerpt)) ||
          (review &&
            item.sourceName === 'hostile-structured-review.md' &&
            corpus.hostileReviewSource.includes(item.excerpt))
        ) ||
        item.evidenceStatus !== 'supported' ||
        typeof item.chunkId !== 'string',
    )
  )
    return false;
  return (
    canonicalJson(taskData.allowedCitationChunkIds) ===
    canonicalJson(taskData.evidence.map((item) => item.chunkId))
  );
}
