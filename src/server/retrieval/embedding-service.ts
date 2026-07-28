import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { config, embeddingModel } from '../config.js';

interface PendingRequest {
  resolve: (embeddings: number[][]) => void;
  reject: (error: Error) => void;
}

export interface EmbeddingStatus {
  mode: 'hybrid' | 'lexical';
  model: string;
  revision: string;
  detail: string | null;
}

export class EmbeddingService {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private status: EmbeddingStatus = {
    mode: 'lexical',
    model: embeddingModel.id,
    revision: embeddingModel.revision,
    detail: 'The embedding model has not been initialised.',
  };

  getStatus(): EmbeddingStatus {
    return { ...this.status };
  }

  private startWorker(): Worker {
    if (this.worker) return this.worker;
    fs.mkdirSync(config.modelCacheDir, { recursive: true, mode: 0o700 });
    const sourceUrl = new URL('./embedding-worker.ts', import.meta.url);
    const compiledUrl = new URL('./embedding-worker.js', import.meta.url);
    const development = sourceUrl.pathname.endsWith('.ts') && fs.existsSync(sourceUrl);
    const worker = new Worker(development ? sourceUrl : compiledUrl, {
      execArgv: development ? ['--import', 'tsx'] : [],
    });
    worker.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      const value = message as {
        type: string;
        id?: string;
        embeddings?: number[][];
        message?: string;
      };
      if (!value.id) return;
      const pending = this.pending.get(value.id);
      if (!pending) return;
      this.pending.delete(value.id);
      if (value.type === 'result' && value.embeddings) {
        this.status = {
          mode: 'hybrid',
          model: embeddingModel.id,
          revision: embeddingModel.revision,
          detail: null,
        };
        pending.resolve(value.embeddings);
      } else if (value.type === 'error') {
        const error = new Error(value.message ?? 'Embedding failed.');
        this.status = {
          mode: 'lexical',
          model: embeddingModel.id,
          revision: embeddingModel.revision,
          detail: 'Semantic retrieval is unavailable. Lexical retrieval remains active.',
        };
        pending.reject(error);
      }
    });
    worker.on('error', (error) =>
      this.failAll(error instanceof Error ? error : new Error('Embedding worker failed.')),
    );
    worker.on('exit', (code) => {
      this.worker = null;
      if (code !== 0) this.failAll(new Error(`Embedding worker stopped with code ${code}.`));
    });
    this.worker = worker;
    return worker;
  }

  private failAll(error: Error): void {
    this.status = {
      mode: 'lexical',
      model: embeddingModel.id,
      revision: embeddingModel.revision,
      detail: 'Semantic retrieval is unavailable. Lexical retrieval remains active.',
    };
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const id = crypto.randomUUID();
    const worker = this.startWorker();
    const result = new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    worker.postMessage({ id, texts, cacheDir: config.modelCacheDir });
    return result;
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
    this.failAll(new Error('Embedding service stopped.'));
  }
}
