import { describe, expect, it } from 'vitest';
import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import retained from '../fixtures/bonsai/retained-encoding-task.json';
import {
  bonsaiContract,
  encodeBonsaiTask,
  bonsaiEvaluationPolicy,
} from '../../scripts/bonsai-evaluation.mjs';
import {
  createBonsaiEvaluationBridge,
  exactBonsaiMessages,
  parseBonsaiReadiness,
} from '../../scripts/bonsai-dispatch.js';

// Pure boundary checks only. No launcher, model, slot or process is invoked.
const readiness = {
  schema: 'prd-bonsai-readiness-v1',
  contractSha256: bonsaiContract.contractSha256,
  modelDigest: 'a'.repeat(64),
  sourceIdentity: {
    commit: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    module_sha256: 'd'.repeat(64),
    consumer_record_sha256: 'e'.repeat(64),
    public_wrapper_sha256: 'f'.repeat(64),
  },
};

describe('Bonsai dispatch preparation', () => {
  it('preserves exact text messages and refuses unsupported content instead of stripping it', () => {
    expect(
      exactBonsaiMessages({
        prompt: [
          { role: 'system', content: 'System instruction.\n' },
          { role: 'user', content: [{ type: 'text', text: '  Literal task\n café  ' }] },
        ],
      }),
    ).toEqual([
      { role: 'system', content: 'System instruction.\n' },
      { role: 'user', content: '  Literal task\n café  ' },
    ]);
    expect(() =>
      exactBonsaiMessages({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    ).toThrow('one exact text');
    expect(() => exactBonsaiMessages({ prompt: [], responseFormat: { type: 'json' } })).toThrow(
      'text-only',
    );
  });

  it('accepts only SDK transport metadata through the real generateText boundary', async () => {
    const requests: Array<ReturnType<typeof encodeBonsaiTask>> = [];
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'boundary-check',
      modelId: 'no-inference',
      supportedUrls: {},
      doGenerate(options) {
        expect(options.headers).toEqual({ 'user-agent': 'ai/7.0.77' });
        expect(options.toolChoice).toEqual({ type: 'none' });
        expect(options.tools).toBeUndefined();
        requests.push(
          encodeBonsaiTask({
            taskId: 'sdk-boundary',
            requestId: 'sdk-boundary',
            messages: exactBonsaiMessages(options),
            maxTokens: bonsaiEvaluationPolicy.maxTokens,
            reasoningTokens: bonsaiEvaluationPolicy.reasoningTokens,
          }),
        );
        return Promise.resolve({
          content: [{ type: 'text', text: 'Boundary check only; no model request.' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: {
              total: undefined,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: undefined, text: undefined, reasoning: undefined },
          },
          warnings: [],
        });
      },
      doStream() {
        throw new Error('Streaming is outside this boundary check.');
      },
    };
    await generateText({
      model,
      system: retained.body.messages[0]!.content,
      prompt: retained.body.messages[1]!.content,
      maxOutputTokens: 1800,
      temperature: 0,
      maxRetries: 0,
      toolChoice: 'none',
      providerOptions: { ollama: { reasoningEffort: 'none', think: false } },
    });
    expect(requests).toHaveLength(1);
    const task = JSON.parse(requests[0]!.bytes.toString()) as {
      body: { messages: unknown; max_tokens: number; reasoning_budget_tokens: number };
      headers?: unknown;
    };
    expect(task.body.messages).toEqual(retained.body.messages);
    expect(task.body.max_tokens).toBe(8192);
    expect(task.body.reasoning_budget_tokens).toBe(4096);
    expect(task).not.toHaveProperty('headers');
    expect(task.body).not.toHaveProperty('headers');
    expect(() => exactBonsaiMessages({ prompt: [], toolChoice: { type: 'auto' } })).toThrow(
      'text-only',
    );
    for (const headers of [
      { 'user-agent': 'caller ai/7.0.77' },
      { 'user-agent': 'ai/7.0.78' },
      { authorization: 'not-a-credential' },
      { 'user-agent': 'ai/7.0.77', 'x-custom': 'value' },
    ]) {
      expect(() => exactBonsaiMessages({ prompt: [], headers })).toThrow('text-only');
    }
  });

  it('requires explicit identities and refuses unsupported or duplicate case preparation', () => {
    expect(() => parseBonsaiReadiness({ ...readiness, modelDigest: '' })).toThrow();
    expect(() => parseBonsaiReadiness({ ...readiness, executable: '/tmp/other' })).toThrow();
    const bridge = createBonsaiEvaluationBridge({
      readiness: parseBonsaiReadiness(readiness),
      onRecord: () => {
        throw new Error('No dispatch is expected in this check.');
      },
    });
    bridge.beginCase('structured-review', 6000);
    expect(() => bridge.beginCase('structured-review', 6000)).toThrow('duplicated');
    expect(() => bridge.assertBatchHealthy()).toThrow('stopped');
    expect(bridge.records).toEqual([]);
    const unsupported = createBonsaiEvaluationBridge({
      readiness: parseBonsaiReadiness(readiness),
      onRecord: () => {},
    });
    expect(() => unsupported.beginCase('structured-review', 9000)).toThrow(
      'changed original budget',
    );
  });
});
