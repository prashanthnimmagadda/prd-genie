import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { TextDecoder } from 'node:util';
import { z } from 'zod';

// Evaluation-only ABI. This module never starts a process or contacts a provider.
export const bonsaiContract = Object.freeze({
  revision: 2,
  contractSha256: '8ff97000e56d7eec37e7c965d9b1913510f0bb77f638cf935826f324e9cd5ff3',
  taskSchemaSha256: '8a489ce630c34d3466e524da371be8398efe8078e7bb848875ac19ea57a6fc02',
  resultSchemaSha256: 'e381c160d6e5b627cc1dde64bd2f311c7612c229611e617bed75f628648241f5',
  inputBytes: 262144,
  outputBytes: 1048576,
  messageBytes: 196608,
  responseBytes: 524288,
});

function loadSchema(name, expected) {
  const bytes = fs.readFileSync(
    new URL(`../evaluations/bonsai-revision02/${name}`, import.meta.url),
  );
  if (sha256(bytes) !== expected) throw new Error('Bonsai contract schema identity mismatch.');
  return JSON.parse(bytes.toString('utf8'));
}

// Repository-formatted copies are semantically identical to the reviewed native
// schemas. Keep both original ABI identities above and local byte identities.
const taskJsonSchema = loadSchema(
  'task.schema.json',
  'dbbe55e4c754571067cf3fc7a0f21043fcfd85d71e3b7108adc02d57561c207d',
);
// Zod's converter needs the inherited object type repeated on each oneOf
// branch. The enclosing body already requires object, so this is equivalent.
const validatorSchema = globalThis.structuredClone(taskJsonSchema);
for (const option of validatorSchema.properties.body.oneOf) option.type = 'object';
const taskSchema = z.fromJSONSchema(validatorSchema);
const resultSchema = z.fromJSONSchema(
  loadSchema(
    'result.schema.json',
    '16feee2616b9061da0e1460d0ee76e4c8107efea1320c9fc54e5be9f4e049637',
  ),
);
export const bonsaiBudgetPairs = Object.freeze(
  taskJsonSchema.properties.body.oneOf.map((option) =>
    Object.freeze([
      option.properties.max_tokens.const,
      option.properties.reasoning_budget_tokens.const,
    ]),
  ),
);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function checkValue(value, depth = 0) {
  if (depth > 8) throw new Error('Bonsai JSON exceeds depth eight.');
  if (typeof value === 'string' && !value.isWellFormed()) throw new Error('Invalid Unicode.');
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
  ) {
    throw new Error('Invalid JSON number.');
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!key.isWellFormed()) throw new Error('Invalid Unicode key.');
      checkValue(child, depth + 1);
    }
  } else if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
    throw new Error('Unsupported JSON value.');
  }
}

// Python's ensure_ascii encoding, including its float-valued sampling controls.
// Other digest inputs here contain only strings, booleans and integer token counts.
const floatFields = new Set([
  'temperature',
  'top_p',
  'min_p',
  'presence_penalty',
  'repeat_penalty',
]);
export function canonicalJson(value, key = '') {
  if (typeof value === 'string') {
    return JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid JSON number.');
    return floatFields.has(key) && Number.isInteger(value) ? `${value}.0` : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((name) => `${canonicalJson(name)}:${canonicalJson(value[name], name)}`)
      .join(',')}}`;
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  throw new Error('Unsupported JSON value.');
}

export const bonsaiEvaluationPolicy = Object.freeze({
  id: 'bonsai-release-corpus-v1',
  maxTokens: 8192,
  reasoningTokens: 4096,
  originalBudgets: Object.freeze({
    'grounded-problem': 1800,
    'conflicting-evidence': 1800,
    'sparse-qualitative-evidence': 1800,
    'testable-requirements': 1800,
    'prompt-injection-resistance': 1800,
    'structured-review': 6000,
  }),
  equivalentToApplicationBudgets: false,
  application9000CeilingVerified: false,
});

export function inspectBonsaiBudgets(requirements) {
  return requirements.map((requirement) => {
    const caseId =
      requirement.id === 'adversarial-structured-review' ? 'structured-review' : requirement.id;
    const approved =
      Object.hasOwn(bonsaiEvaluationPolicy.originalBudgets, caseId) &&
      bonsaiEvaluationPolicy.originalBudgets[caseId] === requirement.maxOutputTokens;
    return {
      ...requirement,
      status: approved ? 'configured' : 'pending',
      nativePairs: bonsaiBudgetPairs,
      policyId: approved ? bonsaiEvaluationPolicy.id : null,
      maxTokens: approved ? bonsaiEvaluationPolicy.maxTokens : null,
      reasoningTokens: approved ? bonsaiEvaluationPolicy.reasoningTokens : null,
      reason: approved
        ? 'Explicit corpus-only generation policy; not equivalent application-budget evidence.'
        : 'No approved corpus configuration for this case and application allowance.',
    };
  });
}

export function encodeBonsaiTask({ taskId, requestId, messages, maxTokens, reasoningTokens }) {
  if (
    !bonsaiBudgetPairs.some(
      ([maximum, reasoning]) => maximum === maxTokens && reasoning === reasoningTokens,
    )
  ) {
    throw new Error(
      'Unsupported Bonsai budget; preserve the original requirement and report pending.',
    );
  }
  const body = {
    model: 'Ternary-Bonsai-2-27B-PQ2_0',
    stream: false,
    seed: 42,
    temperature: 1,
    top_p: 0.95,
    top_k: 20,
    min_p: 0.05,
    presence_penalty: 0,
    repeat_penalty: 1,
    reasoning_effort: 'medium',
    max_tokens: maxTokens,
    reasoning_budget_tokens: reasoningTokens,
    chat_template_kwargs: { enable_thinking: true, preserve_thinking: true },
    messages,
  };
  const task = {
    schema: 'bonsai-evaluation-task-v1',
    task_id: taskId,
    request_id: requestId,
    expected_body_sha256: sha256(canonicalJson(body)),
    body,
  };
  checkValue(task);
  taskSchema.parse(task);
  if (
    messages.at(-1)?.role !== 'user' ||
    messages.reduce((sum, message) => sum + Buffer.byteLength(message.content), 0) >
      bonsaiContract.messageBytes
  ) {
    throw new Error('Bonsai message contract refused.');
  }
  const bytes = Buffer.from(`${canonicalJson(task)}\n`);
  if (bytes.length > bonsaiContract.inputBytes)
    throw new Error('Bonsai task exceeds the input limit.');
  return { task, bytes };
}

function parseClosedJson(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  checkValue(value);
  // JSON.parse validates syntax; this second lexical pass rejects duplicate keys,
  // including differently escaped spellings, before schema validation.
  const stack = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]/g)) {
    const token = match[0];
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && stack.at(-1)) stack.at(-1).key = true;
    else if (token === ':' && stack.at(-1)) stack.at(-1).key = false;
    else if (token.startsWith('"') && stack.at(-1)?.key) {
      const key = JSON.parse(token);
      if (stack.at(-1).keys.has(key)) throw new Error('Duplicate result key.');
      stack.at(-1).keys.add(key);
    }
  }
  return value;
}

export function decodeBonsaiResult(bytes, encoded, expectedSourceIdentity) {
  if (bytes.length > bonsaiContract.outputBytes)
    throw new Error('Bonsai result exceeds the output limit; stop the batch.');
  const result = parseClosedJson(bytes);
  resultSchema.parse(result);
  if (result.status !== 'COMPLETED') {
    if (result.ok) throw new Error('Nonterminal result cannot pass.');
    // UNKNOWN is an outcome, not permission to terminate its holder or retry.
    return { result, usable: false, stopBatch: true };
  }
  const { task } = encoded;
  const expected = expectedSourceIdentity;
  if (
    !expected ||
    Object.keys(expected).length !== 5 ||
    canonicalJson(result.source_identity) !== canonicalJson(expected) ||
    result.task_id !== task.task_id ||
    result.request_id !== task.request_id ||
    result.task_json_sha256 !== sha256(encoded.bytes) ||
    result.body_sha256 !== task.expected_body_sha256 ||
    result.messages_sha256 !== sha256(canonicalJson(task.body.messages)) ||
    result.response_sha256 !== sha256(canonicalJson(result.response)) ||
    !result.raw_provider_response_sha256 ||
    !result.generation ||
    !result.intent_sha256 ||
    !result.api_request_id ||
    result.ok !== true ||
    result.hold ||
    result.custody?.role !== 'controller' ||
    result.custody?.start === null ||
    result.custody?.intent_sha256 !== result.intent_sha256 ||
    result.provider_outcome !== 'TERMINAL_RESPONSE' ||
    result.guard !== 'PASSED' ||
    result.admission !== 'PASSED' ||
    !result.registration_closure_confirmed ||
    result.local_settlement?.status !== 'LOCAL_REGISTERED_SCOPE_SETTLED' ||
    result.local_settlement?.task_id !== `evaluation-${sha256(task.task_id)}` ||
    !result.local_settlement?.generation ||
    !result.local_settlement?.nonce ||
    result.local_settlement?.registration_count < 1 ||
    result.reason !== null ||
    result.policy_failure !== null ||
    result.no_tools?.requested !== true ||
    result.no_tools?.enforced !== true ||
    result.no_tools?.attempted_tool_calls !== 0 ||
    result.no_tools?.executed_tool_calls !== 0 ||
    result.response?.finish_reason !== 'stop' ||
    Buffer.byteLength(result.response.content) > bonsaiContract.responseBytes
  ) {
    throw new Error(
      'Bonsai completion evidence does not bind the exact task and approved source; stop the batch.',
    );
  }
  return { result, usable: true, stopBatch: false };
}
