import type {
  AiActionRequest,
  Citation,
  HealthResponse,
  PrdDocument,
  ProjectSummary,
  ProviderKind,
  ProviderState,
  ReviewFinding,
  SourceSummary,
} from '@shared/types';

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body === undefined || options.body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new ClientApiError(
      response.status,
      payload.error?.code ?? 'request_failed',
      payload.error?.message ?? 'The request could not be completed.',
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  projects: () => request<{ projects: ProjectSummary[] }>('/api/projects'),
  createProject: (name: string, description = '') =>
    request<ProjectSummary>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  importProject: (file: File) => {
    const data = new FormData();
    data.set('file', file);
    return request<{ project: ProjectSummary; prd: PrdDocument }>('/api/projects/import', {
      method: 'POST',
      body: data,
    });
  },
  updateProject: (
    id: string,
    update: Partial<
      Pick<ProjectSummary, 'name' | 'description' | 'selectedProvider' | 'selectedModel'>
    >,
  ) =>
    request<ProjectSummary>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  prd: (id: string) => request<PrdDocument>(`/api/projects/${id}/prd`),
  savePrd: (id: string, revision: number, sections: PrdDocument['sections'], reason: string) =>
    request<PrdDocument>(`/api/projects/${id}/prd`, {
      method: 'PUT',
      body: JSON.stringify({ revision, sections, reason }),
    }),
  sources: (id: string) => request<{ sources: SourceSummary[] }>(`/api/projects/${id}/sources`),
  addSource: (id: string, file: File) => {
    const data = new FormData();
    data.set('file', file);
    return request<SourceSummary>(`/api/projects/${id}/sources`, {
      method: 'POST',
      body: data,
    });
  },
  deleteSource: (projectId: string, sourceId: string) =>
    request<void>(`/api/projects/${projectId}/sources/${sourceId}`, { method: 'DELETE' }),
  sourceLocation: (projectId: string, citation: Citation) =>
    request<{
      id: string;
      locator: string;
      content: string;
      startOffset: number;
      endOffset: number;
    }>(`/api/projects/${projectId}/sources/${citation.sourceId}/locations/${citation.locationId}`),
  providerStates: () => request<{ providers: ProviderState[] }>('/api/session/providers'),
  configureProvider: (
    provider: ProviderKind,
    value: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> },
  ) =>
    request<ProviderState>(`/api/session/providers/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(value),
    }),
  clearProvider: (provider: ProviderKind) =>
    request<void>(`/api/session/providers/${provider}`, { method: 'DELETE' }),
  models: (provider: ProviderKind) =>
    request<{ models: Array<{ id: string; name: string }> }>(`/api/providers/${provider}/models`),
  findings: (id: string) =>
    request<{ findings: ReviewFinding[] }>(`/api/projects/${id}/review-findings`),
  dismissFinding: (projectId: string, findingId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/review-findings/${findingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed' }),
    }),
  acceptFinding: (
    projectId: string,
    findingId: string,
    revision: number,
    proposedMarkdown?: string,
  ) =>
    request<PrdDocument>(`/api/projects/${projectId}/review-findings/${findingId}/accept`, {
      method: 'POST',
      body: JSON.stringify({
        revision,
        ...(proposedMarkdown === undefined ? {} : { proposedMarkdown }),
      }),
    }),
  applyAiRun: (projectId: string, runId: string, revision: number, proposedMarkdown?: string) =>
    request<PrdDocument>(`/api/projects/${projectId}/ai-runs/${runId}/apply`, {
      method: 'POST',
      body: JSON.stringify({
        revision,
        ...(proposedMarkdown === undefined ? {} : { proposedMarkdown }),
      }),
    }),
  restoreRevision: (projectId: string, revision: number, expectedRevision: number) =>
    request<PrdDocument>(`/api/projects/${projectId}/revisions/${revision}/restore`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision }),
    }),
};

export interface ActionStreamHandlers {
  onText: (delta: string) => void;
  onCitation: (citation: Citation) => void;
  onFinding: (finding: ReviewFinding) => void;
  onStatus: (status: { stage: string; detail: string }) => void;
  onCompletion: (completion: { runId: string; revision: number }) => void;
}

export async function runAction(
  body: AiActionRequest,
  handlers: ActionStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/ai/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new ClientApiError(
      response.status,
      payload.error?.code ?? 'request_failed',
      payload.error?.message ?? 'The AI action could not be started.',
    );
  }
  if (!response.body)
    throw new ClientApiError(502, 'empty_stream', 'The provider returned no stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      const part = JSON.parse(raw) as {
        type: string;
        delta?: string;
        errorText?: string;
        data?: unknown;
      };
      if (part.type === 'text-delta' && part.delta) handlers.onText(part.delta);
      if (part.type === 'data-citation') handlers.onCitation(part.data as Citation);
      if (part.type === 'data-finding') handlers.onFinding(part.data as ReviewFinding);
      if (part.type === 'data-status') {
        handlers.onStatus(part.data as { stage: string; detail: string });
      }
      if (part.type === 'data-completion') {
        handlers.onCompletion(part.data as { runId: string; revision: number });
      }
      if (part.type === 'error') {
        const payload = JSON.parse(part.errorText ?? '{}') as { code?: string; message?: string };
        throw new ClientApiError(
          502,
          payload.code ?? 'provider_error',
          payload.message ?? 'The provider could not complete the action.',
        );
      }
    }
    if (done) break;
  }
}
