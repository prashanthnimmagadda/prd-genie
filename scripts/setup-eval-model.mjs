import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const baseModel = process.env.PRD_GENIE_EVAL_BASE_MODEL ?? 'qwen3:4b-instruct';
const evaluationModel = process.env.PRD_GENIE_EVAL_MODEL ?? 'prd-genie-qwen3-4b-instruct:latest';
const contextTokens = Number(process.env.PRD_GENIE_EVAL_CONTEXT_TOKENS ?? '8192');

if (!Number.isInteger(contextTokens) || contextTokens < 4096 || contextTokens > 32768) {
  throw new Error('PRD_GENIE_EVAL_CONTEXT_TOKENS must be an integer from 4096 to 32768.');
}

const models = run('ollama', ['list']).stdout;
if (!models.includes(baseModel)) {
  throw new Error(`Pull the evaluation base model first: ollama pull ${baseModel}`);
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-eval-model-'));
const modelfile = path.join(directory, 'Modelfile');
try {
  fs.writeFileSync(modelfile, `FROM ${baseModel}\nPARAMETER num_ctx ${contextTokens}\n`, 'utf8');
  run('ollama', ['create', evaluationModel, '-f', modelfile]);
  console.log(`Prepared ${evaluationModel} with a ${contextTokens}-token context.`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} exited with status ${result.status}.`);
  }
  return result;
}
