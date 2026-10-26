export const bonsaiContract: Readonly<{
  revision: number;
  contractSha256: string;
  taskSchemaSha256: string;
  resultSchemaSha256: string;
  inputBytes: number;
  outputBytes: number;
  messageBytes: number;
  responseBytes: number;
}>;
export const bonsaiBudgetPairs: ReadonlyArray<readonly [number, number]>;
export function sha256(bytes: string | Uint8Array): string;
export function canonicalJson(value: unknown): string;
export function inspectBonsaiBudgets<T extends { id: string; maxOutputTokens: number }>(
  requirements: T[],
): Array<
  T & {
    status: 'configured' | 'pending';
    policyId: string | null;
    maxTokens: number | null;
    reasoningTokens: number | null;
    nativePairs: typeof bonsaiBudgetPairs;
    reason: string;
  }
>;
export interface BonsaiTaskInput {
  taskId: string;
  requestId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  reasoningTokens: number;
}
export interface EncodedBonsaiTask {
  task: Record<string, unknown>;
  bytes: Buffer;
}
export function encodeBonsaiTask(input: BonsaiTaskInput): EncodedBonsaiTask;
export function decodeBonsaiResult(
  bytes: Uint8Array,
  encoded: EncodedBonsaiTask,
  expectedSourceIdentity: {
    commit: string;
    tree: string;
    module_sha256: string;
    consumer_record_sha256: string;
    public_wrapper_sha256: string;
  },
): { result: Record<string, unknown>; usable: boolean; stopBatch: boolean };

export const bonsaiEvaluationPolicy: Readonly<{
  id: 'bonsai-release-corpus-v1';
  maxTokens: 8192;
  reasoningTokens: 4096;
  originalBudgets: Readonly<Record<string, number>>;
  equivalentToApplicationBudgets: false;
  application9000CeilingVerified: false;
}>;
