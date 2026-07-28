import { parentPort } from 'node:worker_threads';
import { pipeline } from '@huggingface/transformers';
import { embeddingModel } from '../config.js';

interface EmbedRequest {
  id: string;
  texts: string[];
  cacheDir: string;
}

if (!parentPort) throw new Error('Embedding worker must run in a worker thread.');

let extractorPromise: ReturnType<typeof createExtractor> | null = null;

async function createExtractor(cacheDir: string) {
  return pipeline('feature-extraction', embeddingModel.id, {
    revision: embeddingModel.revision,
    cache_dir: cacheDir,
    dtype: 'q8',
    progress_callback: (progress) => {
      parentPort?.postMessage({ type: 'progress', progress });
    },
  });
}

parentPort.on('message', (request: EmbedRequest) => {
  void (async () => {
    try {
      extractorPromise ??= createExtractor(request.cacheDir);
      const extractor = await extractorPromise;
      const embeddings: number[][] = [];
      for (const text of request.texts) {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        const values = output.tolist() as number[][];
        embeddings.push(values[0] ?? []);
      }
      parentPort?.postMessage({ type: 'result', id: request.id, embeddings });
    } catch (error) {
      parentPort?.postMessage({
        type: 'error',
        id: request.id,
        message: error instanceof Error ? error.message : 'Embedding failed.',
      });
    }
  })();
});
