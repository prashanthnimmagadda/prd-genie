import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerState = vi.hoisted(() => {
  class SyntheticWorker {
    static instances: SyntheticWorker[] = [];
    readonly handlers = new Map<string, Array<(value: unknown) => void>>();
    readonly postMessage = vi.fn();
    readonly terminate = vi.fn(() => Promise.resolve(0));

    constructor() {
      SyntheticWorker.instances.push(this);
    }

    on(event: string, handler: (value: unknown) => void): this {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    emit(event: string, value: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(value);
    }
  }
  return { SyntheticWorker };
});

vi.mock('node:worker_threads', () => ({ Worker: workerState.SyntheticWorker }));

import { EmbeddingService } from '../../src/server/retrieval/embedding-service.js';

describe('EmbeddingService', () => {
  beforeEach(() => {
    workerState.SyntheticWorker.instances.length = 0;
    vi.clearAllMocks();
  });

  it('starts in lexical mode and skips worker creation for empty input', async () => {
    const service = new EmbeddingService();
    expect(service.getStatus()).toMatchObject({ mode: 'lexical' });
    await expect(service.embed([])).resolves.toEqual([]);
    expect(workerState.SyntheticWorker.instances).toHaveLength(0);
    await service.close();
  });

  it('resolves worker results, reuses the worker, and reports hybrid mode', async () => {
    const service = new EmbeddingService();
    const first = service.embed(['one']);
    const worker = workerState.SyntheticWorker.instances[0]!;
    const firstMessage = worker.postMessage.mock.calls[0]?.[0] as { id: string };
    worker.emit('message', {
      type: 'result',
      id: firstMessage.id,
      embeddings: [[1, 0]],
    });
    await expect(first).resolves.toEqual([[1, 0]]);
    expect(service.getStatus()).toMatchObject({ mode: 'hybrid', detail: null });

    const second = service.embed(['two']);
    const secondMessage = worker.postMessage.mock.calls[1]?.[0] as { id: string };
    worker.emit('message', { type: 'error', id: secondMessage.id, message: 'Synthetic failure' });
    await expect(second).rejects.toThrow('Synthetic failure');
    expect(service.getStatus()).toMatchObject({ mode: 'lexical' });

    const third = service.embed(['three']);
    const thirdMessage = worker.postMessage.mock.calls[2]?.[0] as { id: string };
    worker.emit('message', { type: 'error', id: thirdMessage.id });
    await expect(third).rejects.toThrow('Embedding failed');
    await service.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects pending work when the worker errors or exits unexpectedly', async () => {
    const service = new EmbeddingService();
    const failed = service.embed(['one']);
    const worker = workerState.SyntheticWorker.instances[0]!;
    worker.emit('message', null);
    worker.emit('message', {});
    worker.emit('message', { type: 'ignored' });
    worker.emit('message', { type: 'result', id: 'unknown', embeddings: [[1]] });
    worker.emit('error', new Error('Worker crashed'));
    await expect(failed).rejects.toThrow('Worker crashed');

    const nonErrorFailure = service.embed(['again']);
    worker.emit('error', 'not an error instance');
    await expect(nonErrorFailure).rejects.toThrow('Embedding worker failed');
    worker.emit('exit', 1);

    const exited = service.embed(['two']);
    const replacement = workerState.SyntheticWorker.instances[1]!;
    replacement.emit('exit', 2);
    await expect(exited).rejects.toThrow('stopped with code 2');
    replacement.emit('exit', 0);
    await service.close();
  });
});
