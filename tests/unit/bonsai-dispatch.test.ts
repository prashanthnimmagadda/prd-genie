import { describe, expect, it } from 'vitest';
import { bonsaiContract } from '../../scripts/bonsai-evaluation.mjs';
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
