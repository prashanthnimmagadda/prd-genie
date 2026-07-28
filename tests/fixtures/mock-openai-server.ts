import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.env.PRD_GENIE_MOCK_PROVIDER_PORT ?? 4312);
const model = 'synthetic-prd-model';

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    json(response, 200, { object: 'list', data: [{ id: model, object: 'model' }] });
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    const body = await readJson(request);
    const prompt = JSON.stringify(body.messages ?? []);
    const isReview = Boolean(body.response_format) || /Review the PRD/i.test(prompt);
    if (isReview) {
      const sectionId =
        prompt.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}): Problem/i,
        )?.[1] ?? 'Problem';
      const chunkId = prompt.match(/source chunk=\\?"([^"\\]+)/i)?.[1];
      completion(response, {
        summary:
          'The Problem section lacks a clear consequence for the affected user, which weakens prioritisation. Add the observed review delay without introducing an unsupported business claim.',
        findings: [
          {
            category: 'clarity',
            severity: 'warning',
            targetSectionId: sectionId,
            rationale:
              'The evidence establishes repeated draft loss and reconstruction time, but the user consequence is not explicit.',
            citationChunkIds: chunkId ? [chunkId] : [],
            proposedMarkdown:
              'Product managers lose unsaved PRD work while preparing stakeholder reviews, forcing them to reconstruct decisions and delaying review readiness.',
          },
        ],
      });
      return;
    }

    streamCompletion(
      response,
      'Product managers lose unsaved PRD work while preparing stakeholder reviews, forcing them to reconstruct decisions and delaying review readiness.',
    );
    return;
  }

  json(response, 404, { error: { message: 'Synthetic endpoint not found.' } });
});

server.listen(port, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function completion(response: ServerResponse, output: unknown): void {
  json(response, 200, {
    id: 'chatcmpl-synthetic-review',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(output) },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
  });
}

function streamCompletion(response: ServerResponse, content: string): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const part of [content.slice(0, 78), content.slice(78)]) {
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-synthetic-draft',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: part }, finish_reason: null }],
      })}\n\n`,
    );
  }
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-synthetic-draft',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
