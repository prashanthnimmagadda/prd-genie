import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { z } from 'zod';
import {
  bonsaiContract,
  bonsaiEvaluationPolicy,
  decodeBonsaiResult,
  encodeBonsaiTask,
  sha256,
  type BonsaiTaskInput,
} from './bonsai-evaluation.mjs';

const fixed = Object.freeze({
  python:
    '/Users/prashi/.local/share/bonsai2-service/releases/cpython-3.11.15-supervisor-v1/python/bin/python3.11',
  slotHelper: '/Volumes/Crucial X10/prime-workspace/kairos/runtime/kairos_process_lock.py',
  slotHelperSha256: '9eb45185962a79c33751f8c499e6a66847c2575add61fc028bfd5f855929379c',
  slot: '/Volumes/Crucial X10/prime-workspace/kairos/outputs/.kairos-heavy-browser-slot.flock',
  publicWrapper: '/Users/prashi/.local/bin/hermes',
});

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const readinessSchema = z
  .object({
    schema: z.literal('prd-bonsai-readiness-v1'),
    contractSha256: z.literal(bonsaiContract.contractSha256),
    modelDigest: digest,
    sourceIdentity: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        tree: z.string().regex(/^[a-f0-9]{40}$/),
        module_sha256: digest,
        consumer_record_sha256: digest,
        public_wrapper_sha256: digest,
      })
      .strict(),
  })
  .strict();

export type BonsaiReadiness = z.infer<typeof readinessSchema>;
export function parseBonsaiReadiness(value: unknown): BonsaiReadiness {
  return readinessSchema.parse(value);
}

// The operator supplies pins from the separately approved installed native
// revision and actual model artifact. Staged source is not installation proof.
// Native admission and the returned receipt must still verify these identities.
export function verifyBonsaiReadiness(readiness: BonsaiReadiness): void {
  parseBonsaiReadiness(readiness);
  if (
    sha256(fs.readFileSync(fixed.slotHelper)) !== fixed.slotHelperSha256 ||
    sha256(fs.readFileSync(fixed.publicWrapper)) !== readiness.sourceIdentity.public_wrapper_sha256
  ) {
    throw new Error('Bonsai installed launcher identity differs from the approved readiness pins.');
  }
  fs.accessSync(fixed.python, fs.constants.X_OK);
  fs.accessSync(fixed.publicWrapper, fs.constants.X_OK);
}

const cases = new Map(Object.entries(bonsaiEvaluationPolicy.originalBudgets));

export interface BonsaiDispatchRecord {
  caseId: string;
  originalMaxOutputTokens: number;
  taskJson: string;
  result: Record<string, unknown> | null;
  status: 'PREPARED' | 'COMPLETED' | 'INCOMPLETE' | 'NOT_SENT' | 'UNKNOWN';
  reason?: string;
  runId?: string;
  // Untrusted local observations for operator investigation only. A PID may
  // have exited or been reused; these fields never authorise signalling or
  // establish descriptor custody, native identity or provider settlement.
  observation?: {
    launcherPid: number | null;
    receiptBytesBase64: string;
    receiptSha256: string;
    receiptComplete: boolean;
    receiptTruncated: boolean;
    custodyOrSettlementVerified: false;
  };
}

// Only the existing text-only evaluation prompt shape is supported. Refuse
// other content instead of silently stripping or concatenating meaningful parts.
export function exactBonsaiMessages(
  options: LanguageModelV3CallOptions,
): BonsaiTaskInput['messages'] {
  if (
    options.tools?.length ||
    (options.toolChoice && options.toolChoice.type !== 'none') ||
    (options.responseFormat && options.responseFormat.type !== 'text') ||
    options.stopSequences?.length ||
    (options.headers && Object.values(options.headers).some((value) => value !== undefined))
  ) {
    throw new Error('Bonsai evaluation accepts only the unchanged text-only corpus requests.');
  }
  return options.prompt.map((message) => {
    if (message.providerOptions && Object.keys(message.providerOptions).length) {
      throw new Error('Per-message provider settings cannot be omitted from an exact task.');
    }
    if (message.role === 'system') return { role: 'system', content: message.content };
    if (message.role === 'tool' || message.content.length !== 1) {
      throw new Error('Bonsai evaluation requires one exact text part per message.');
    }
    const part = message.content[0];
    if (
      !part ||
      part.type !== 'text' ||
      (part.providerOptions && Object.keys(part.providerOptions).length)
    ) {
      throw new Error('Bonsai evaluation refuses non-text or annotated content.');
    }
    return { role: message.role, content: part.text };
  });
}

type DispatchObservation = {
  bytes?: Buffer;
  reason?: string;
  launcherPid?: number;
  receiptComplete?: boolean;
  receiptTruncated?: boolean;
};

// EOF is authoritative for receipt delivery, not child exit. UNKNOWN may name
// a still-live public holder. Never signal, kill, retry or release its slot here.
function dispatch(
  bytes: Buffer,
  worker: string,
  signal?: AbortSignal,
): Promise<DispatchObservation> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ reason: 'caller_cancelled_before_launcher' });
      return;
    }
    const child = spawn(
      fixed.python,
      [
        '-E',
        '-s',
        '-S',
        '-B',
        fixed.slotHelper,
        'run',
        '--lock',
        fixed.slot,
        '--worker',
        worker,
        '--',
        fixed.publicWrapper,
        '--run-module',
        'hermes_cli.bonsai_evaluation',
        '--profile',
        'default',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], detached: true },
    );
    let settled = false;
    let total = 0;
    const chunks: Buffer[] = [];
    // Native execution+settlement is 1860 seconds; allow the existing launcher
    // admission 15 seconds plus receipt delivery. This observer never kills it.
    const timer = setTimeout(() => finish({ reason: 'receipt_deadline_unknown' }), 1890_000);
    const finish = (observation: DispatchObservation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.unref();
      // Pipe sockets keep Node alive even when the public UNKNOWN holder parks.
      // Unref leaves them open and draining; destroying them could disrupt it.
      for (const stream of [child.stdin, child.stdout]) {
        if (stream instanceof Socket) stream.unref();
      }
      resolve({
        ...observation,
        bytes: observation.bytes ?? Buffer.concat(chunks),
        launcherPid: child.pid,
        receiptTruncated: total > bonsaiContract.outputBytes,
      });
    };
    const abort = () => finish({ reason: 'caller_cancelled_outcome_unknown' });
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish({ reason: 'launcher_or_pipe_outcome_unknown' }));
    child.stdin.on('error', () => finish({ reason: 'input_delivery_outcome_unknown' }));
    child.stdout.on('error', () => finish({ reason: 'receipt_delivery_outcome_unknown' }));
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return; // Continue draining without retaining unbounded data.
      total += chunk.length;
      if (total > bonsaiContract.outputBytes) {
        const retained = chunks.reduce((sum, value) => sum + value.length, 0);
        chunks.push(chunk.subarray(0, bonsaiContract.outputBytes - retained));
        finish({ reason: 'oversized_receipt_outcome_unknown' });
        return;
      }
      chunks.push(chunk);
    });
    child.stdout.on('end', () => finish({ bytes: Buffer.concat(chunks), receiptComplete: true }));
    child.stdin.end(bytes);
    if (signal?.aborted) abort();
  });
}

export function createBonsaiEvaluationBridge(options: {
  readiness: BonsaiReadiness;
  onRecord: (record: BonsaiDispatchRecord) => void | Promise<void>;
}) {
  const readiness = parseBonsaiReadiness(options.readiness);
  const records: BonsaiDispatchRecord[] = [];
  const used = new Set<string>();
  let selected: { id: string; limit: number } | undefined;
  let busy = false;
  let failed = false;
  const assertBatchHealthy = () => {
    if (failed) throw new Error('Bonsai evaluation batch stopped; automatic retry is forbidden.');
    if (busy) throw new Error('Bonsai evaluation already has an unsettled request.');
  };
  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'custom:bonsai-v2',
    modelId: 'Ternary-Bonsai-2-27B-PQ2_0',
    supportedUrls: {},
    async doGenerate(call) {
      assertBatchHealthy();
      const current = selected;
      selected = undefined;
      if (!current || used.has(current.id) || call.maxOutputTokens !== current.limit) {
        failed = true;
        throw new Error(
          'Bonsai evaluation case or original budget does not match the approved corpus.',
        );
      }
      used.add(current.id);
      busy = true;
      try {
        if (call.abortSignal?.aborted) throw new Error('Bonsai request cancelled before dispatch.');
        verifyBonsaiReadiness(readiness);
        const encoded = encodeBonsaiTask({
          taskId: `prd-${current.id}-${randomUUID()}`,
          requestId: randomUUID(),
          messages: exactBonsaiMessages(call),
          maxTokens: bonsaiEvaluationPolicy.maxTokens,
          reasoningTokens: bonsaiEvaluationPolicy.reasoningTokens,
        });
        const record: BonsaiDispatchRecord = {
          caseId: current.id,
          originalMaxOutputTokens: current.limit,
          taskJson: encoded.bytes.toString('utf8'),
          result: null,
          status: 'PREPARED',
        };
        records.push(record);
        await options.onRecord(structuredClone(record));
        const observed = await dispatch(
          encoded.bytes,
          `prd-evaluation-${current.id}`,
          call.abortSignal,
        );
        record.status = 'UNKNOWN';
        const observedBytes = observed.bytes ?? Buffer.alloc(0);
        record.observation = {
          launcherPid: observed.launcherPid ?? null,
          receiptBytesBase64: observedBytes.toString('base64'),
          receiptSha256: sha256(observedBytes),
          receiptComplete: observed.receiptComplete === true,
          receiptTruncated: observed.receiptTruncated === true,
          custodyOrSettlementVerified: false,
        };
        if (observed.reason || !observed.bytes) {
          record.reason = observed.reason;
          await options.onRecord(structuredClone(record));
          throw new Error(
            'Bonsai request outcome is UNKNOWN; retain custody and stop without retry.',
          );
        }
        let decoded;
        try {
          decoded = decodeBonsaiResult(observed.bytes, encoded, readiness.sourceIdentity);
        } catch {
          record.reason = 'invalid_receipt_outcome_unknown';
          await options.onRecord(structuredClone(record));
          throw new Error(
            'Bonsai receipt could not be verified; retain custody and stop without retry.',
          );
        }
        record.result = decoded.result;
        record.status = decoded.result.status as BonsaiDispatchRecord['status'];
        await options.onRecord(structuredClone(record));
        if (!decoded.usable || decoded.stopBatch) {
          throw new Error(`Bonsai returned ${record.status}; batch stopped without retry.`);
        }
        const response = decoded.result.response as {
          content: string;
          usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        return {
          content: [{ type: 'text', text: response.content }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: {
              total: response.usage.prompt_tokens,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: response.usage.completion_tokens,
              text: undefined,
              reasoning: undefined,
            },
          },
          warnings: [],
        };
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        busy = false;
      }
    },
    doStream() {
      failed = true;
      return Promise.reject(
        new Error('Bonsai revision02 evaluation is buffered only; streaming is unsupported.'),
      );
    },
  };
  return {
    model,
    records,
    beginCase(id: string, originalMaxOutputTokens: number) {
      assertBatchHealthy();
      if (selected || used.has(id) || cases.get(id) !== originalMaxOutputTokens) {
        failed = true;
        throw new Error('Bonsai case is unsupported, duplicated or has a changed original budget.');
      }
      selected = { id, limit: originalMaxOutputTokens };
    },
    assertBatchHealthy,
  };
}
