import { createHash } from 'node:crypto';
import { canonicalJson, decodeBonsaiResult } from './bonsai-evaluation.mjs';

// One approved continuation, not an arbitrary case-skipping interface.
export const continuationEvidence = {
  failureSha256: '6f81d87f61e4759b47795a16e2074bcf8d908085569f9c899f9052b63b0fd3f1',
  receiptSha256: '37365bf02a399b84e00804eb4e50061d7736d34177d50ad6491e036c084e6d6f',
} as const;

export function readApprovedContinuation(failureBytes: Buffer, receiptBytes: Buffer) {
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  if (
    hash(failureBytes) !== continuationEvidence.failureSha256 ||
    hash(receiptBytes) !== continuationEvidence.receiptSha256
  )
    throw new Error(
      'Continuation requires the exact preserved first response and failure receipt.',
    );
  // Shapes are pinned by the exact immutable byte hashes above; native semantics
  // are additionally checked by the existing closed-schema decoder below.
  const failure = JSON.parse(failureBytes.toString('utf8')) as {
    gitSha: string;
    status: string;
    releaseEvidence: boolean;
    completedScenarios: unknown[];
    records: Array<{ caseId: string; status: string; taskJson: string; result: unknown }>;
  };
  const receipt = JSON.parse(receiptBytes.toString('utf8')) as {
    source_identity: Parameters<typeof decodeBonsaiResult>[2];
    response: { content: string };
  };
  const record = failure.records[0];
  if (
    failure.status !== 'stopped' ||
    failure.releaseEvidence !== false ||
    failure.records.length !== 1 ||
    failure.completedScenarios.length !== 0 ||
    !record ||
    record.caseId !== 'grounded-problem' ||
    record.status !== 'COMPLETED' ||
    canonicalJson(record.result) !== canonicalJson(receipt)
  )
    throw new Error('Prior case accounting is incompatible with this continuation.');
  const decoded = decodeBonsaiResult(
    receiptBytes,
    {
      task: JSON.parse(record.taskJson) as Record<string, unknown>,
      bytes: Buffer.from(record.taskJson),
    },
    receipt.source_identity,
  );
  if (!decoded.usable || decoded.stopBatch)
    throw new Error('Prior response is not settled and complete.');
  return {
    ...continuationEvidence,
    priorGitSha: failure.gitSha,
    caseId: 'grounded-problem' as const,
    status: 'review_required' as const,
    accepted: false as const,
    releaseEvidence: false as const,
    generatedText: receipt.response.content,
    fixtureUse:
      'Unchanged UNACCEPTED input for structured review; no AI acceptance record is created.',
  };
}
