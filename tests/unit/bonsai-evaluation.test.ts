import { describe, expect, it } from 'vitest';
import retained from '../fixtures/bonsai/retained-encoding-task.json';
import {
  bonsaiBudgetPairs,
  canonicalJson,
  decodeBonsaiResult,
  encodeBonsaiTask,
  inspectBonsaiBudgets,
  sha256,
  type BonsaiTaskInput,
} from '../../scripts/bonsai-evaluation.mjs';
import { outputTokenLimit, reviewTokenLimit } from '../../src/server/providers/action-service.js';
import { DEFAULT_STRUCTURE_SECTIONS } from '../../src/shared/types.js';

// Retained native revision02 codec fixture. Its 2048/1024 pair is NOT an
// approved mapping for the release corpus. No provider/process is invoked.
const input: BonsaiTaskInput = {
  taskId: retained.task_id,
  requestId: retained.request_id,
  messages: retained.body.messages as BonsaiTaskInput['messages'],
  maxTokens: retained.body.max_tokens,
  reasoningTokens: retained.body.reasoning_budget_tokens,
};

describe('Bonsai revision02 evaluation boundary', () => {
  it('matches the retained Python canonical body digest and preserves messages', () => {
    const encoded = encodeBonsaiTask(input);
    expect(encoded.task.expected_body_sha256).toBe(retained.expected_body_sha256);
    expect((JSON.parse(encoded.bytes.toString()) as { body: unknown }).body).toEqual(retained.body);
    expect(canonicalJson('café 😀')).toBe('"caf\\u00e9 \\ud83d\\ude00"');
    expect(sha256(canonicalJson(retained.body))).toBe(retained.expected_body_sha256);
  });

  it('keeps unchanged application budgets pending instead of selecting a nearby pair', () => {
    const limits = [
      outputTokenLimit('rewrite', 'selection'),
      outputTokenLimit('rewrite', 'section'),
      reviewTokenLimit('section', 1),
      outputTokenLimit('draft', 'document'),
      reviewTokenLimit('document', 100),
    ];
    expect(limits).toEqual([1000, 1800, 3000, 6000, 9000]);
    expect(reviewTokenLimit('document', DEFAULT_STRUCTURE_SECTIONS.length)).toBe(6000);
    const pending = inspectBonsaiBudgets(
      limits.map((maxOutputTokens) => ({ id: String(maxOutputTokens), maxOutputTokens })),
    );
    expect(pending.every((row) => row.status === 'pending')).toBe(true);
    for (const maximum of limits) {
      expect(bonsaiBudgetPairs.some(([value]) => value === maximum)).toBe(false);
      expect(() => encodeBonsaiTask({ ...input, maxTokens: maximum })).toThrow(
        'Unsupported Bonsai budget',
      );
    }
  });

  it('refuses malformed input and a purported completion without revision02 evidence', () => {
    expect(() =>
      encodeBonsaiTask({ ...input, messages: [{ role: 'user', content: '\ud800' }] }),
    ).toThrow('Unicode');
    expect(() =>
      encodeBonsaiTask({ ...input, messages: [{ role: 'assistant', content: 'unfinished' }] }),
    ).toThrow('message contract');
    expect(() =>
      encodeBonsaiTask({ ...input, messages: [{ role: 'user', content: 'x'.repeat(196609) }] }),
    ).toThrow('message contract');
    const encoded = encodeBonsaiTask(input);
    const identity = {
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      module_sha256: 'c'.repeat(64),
      consumer_record_sha256: 'd'.repeat(64),
      public_wrapper_sha256: 'e'.repeat(64),
    };
    expect(() =>
      decodeBonsaiResult(
        Buffer.from('{"status":"UNKNOWN","status":"COMPLETED"}'),
        encoded,
        identity,
      ),
    ).toThrow('Duplicate');
    expect(() =>
      decodeBonsaiResult(Buffer.from('{"status":"COMPLETED","ok":true}'), encoded, identity),
    ).toThrow();
  });

  it('accepts the settled controller ABI shape and stops on UNKNOWN without requiring holder exit', () => {
    // Schema fixture only, not a live receipt or model-quality result. Covers the
    // reviewed mismatch: native COMPLETED retains historical controller identity.
    const encoded = encodeBonsaiTask(input);
    const identity = {
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      module_sha256: 'c'.repeat(64),
      consumer_record_sha256: 'd'.repeat(64),
      public_wrapper_sha256: 'e'.repeat(64),
    };
    const response = {
      content: 'Fixture only.',
      finish_reason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    };
    const receipt = {
      schema: 'bonsai-evaluation-result-v1',
      status: 'COMPLETED',
      ok: true,
      task_id: input.taskId,
      request_id: input.requestId,
      task_json_sha256: sha256(encoded.bytes),
      body_sha256: retained.expected_body_sha256,
      messages_sha256: sha256(canonicalJson(input.messages)),
      response,
      response_sha256: sha256(canonicalJson(response)),
      raw_provider_response_sha256: 'f'.repeat(64),
      generation: '1'.repeat(64),
      api_request_id: 'fixture-only',
      guard: 'PASSED',
      admission: 'PASSED',
      no_tools: {
        contract: 'hermes-task-no-tools-v1',
        requested: true,
        enforced: true,
        attempted_tool_calls: 0,
        executed_tool_calls: 0,
      },
      source_identity: identity,
      reason: null,
      policy_failure: null,
      provider_outcome: 'TERMINAL_RESPONSE',
      hold: false,
      redispatch_allowed: false,
      registration_closure_confirmed: true,
      intent_sha256: '2'.repeat(64),
      local_settlement: {
        task_id: `evaluation-${sha256(input.taskId)}`,
        generation: 'scope-fixture',
        nonce: 'fixture',
        status: 'LOCAL_REGISTERED_SCOPE_SETTLED',
        sealed_at: 1,
        registration_count: 1,
        records_sha256: '3'.repeat(64),
        provider_outcome: 'NOT_ATTESTED',
      },
      custody: {
        role: 'controller',
        pid: 1,
        start: 1,
        slot_device: 1,
        slot_inode: 1,
        intent_sha256: '2'.repeat(64),
        provider_settlement: 'NOT_ATTESTED',
        automatic_release: false,
      },
      policy: {
        execution_seconds: 1800,
        interrupt_seconds: 30,
        term_seconds: 15,
        kill_settlement_seconds: 15,
      },
      coverage: 'participating KAIROS/PRD slot; registered local custody only',
    };
    const decode = (value: unknown) =>
      decodeBonsaiResult(Buffer.from(JSON.stringify(value)), encoded, identity);
    expect(decode(receipt).usable).toBe(true);
    expect(() => decode({ ...receipt, custody: null })).toThrow('completion evidence');
    expect(() => decode({ ...receipt, body_sha256: '0'.repeat(64) })).toThrow(
      'completion evidence',
    );
    expect(() =>
      decode({ ...receipt, no_tools: { ...receipt.no_tools, attempted_tool_calls: 1 } }),
    ).toThrow('completion evidence');
    const unknown = {
      ...receipt,
      status: 'UNKNOWN',
      ok: false,
      provider_outcome: 'UNKNOWN',
      hold: true,
      response: null,
      response_sha256: null,
      custody: { ...receipt.custody, role: 'passive-public-custodian' },
    };
    expect(decode(unknown)).toMatchObject({
      usable: false,
      stopBatch: true,
      result: { custody: unknown.custody },
    });
  });
});
