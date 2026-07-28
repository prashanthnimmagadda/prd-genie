import { z } from 'zod';
import type { UIMessage } from 'ai';

export const providerKinds = [
  'openai',
  'anthropic',
  'google',
  'openai-compatible',
  'ollama',
] as const;
export type ProviderKind = (typeof providerKinds)[number];

export const credentialSources = ['session', 'environment', 'none'] as const;
export type CredentialSource = (typeof credentialSources)[number];

export const aiActions = ['draft', 'review', 'rewrite', 'ask'] as const;
export type AiAction = (typeof aiActions)[number];

export const actionScopes = ['selection', 'section', 'document'] as const;
export type ActionScope = (typeof actionScopes)[number];

export const evidenceStatuses = ['supported', 'unsupported', 'conflicting', 'inference'] as const;
export type EvidenceStatus = (typeof evidenceStatuses)[number];

export const findingCategories = [
  'completeness',
  'clarity',
  'testability',
  'evidence',
  'contradiction',
  'risk',
  'assumption',
  'success-measure',
] as const;
export type FindingCategory = (typeof findingCategories)[number];

export const severityLevels = ['info', 'warning', 'blocking'] as const;
export type Severity = (typeof severityLevels)[number];

export interface Citation {
  id: string;
  sourceId: string;
  sourceName: string;
  locationId: string;
  locator: string;
  chunkId: string;
  excerpt: string;
  evidenceStatus: EvidenceStatus;
}

export interface ReviewFinding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  targetSectionId: string;
  rationale: string;
  citations: Citation[];
  proposedPatch: SectionPatch | null;
  sourceRevision: number;
  status: 'open' | 'accepted' | 'dismissed' | 'stale';
}

export interface SectionPatch {
  sectionId: string;
  beforeMarkdown: string;
  afterMarkdown: string;
}

export interface AiRunProposal {
  id: string;
  projectId: string;
  action: AiAction;
  scope: ActionScope;
  provider: ProviderKind;
  model: string;
  sourceRevision: number;
  targetSectionId: string | null;
  selectionText: string | null;
  outputText: string | null;
  appliedRevision: number | null;
  status: 'running' | 'completed' | 'failed';
  errorCode: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  selectedProvider: ProviderKind | null;
  selectedModel: string | null;
}

export interface PrdSection {
  id: string;
  projectId: string;
  title: string;
  body: string;
  position: number;
  updatedAt: string;
}

export interface PrdDocument {
  projectId: string;
  revision: number;
  sections: PrdSection[];
}

export interface SourceSummary {
  id: string;
  projectId: string;
  name: string;
  mediaType: string;
  size: number;
  hash: string;
  status: 'processing' | 'ready' | 'partial' | 'failed';
  error: string | null;
  createdAt: string;
}

export interface ProviderState {
  provider: ProviderKind;
  credentialSource: CredentialSource;
  configured: boolean;
  baseUrl: string | null;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  retrieval: {
    mode: 'hybrid' | 'lexical';
    model: string;
    revision: string;
    detail: string | null;
  };
}

export type WorkbenchMessage = UIMessage<
  { runId?: string },
  {
    status: { stage: string; detail: string };
    citation: Citation;
    finding: ReviewFinding;
    patch: SectionPatch;
    completion: { runId: string; revision: number };
  }
>;

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
});

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    selectedProvider: z.enum(providerKinds).nullable().optional(),
    selectedModel: z.string().trim().min(1).max(300).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export const sectionUpdateSchema = z.object({
  revision: z.number().int().nonnegative(),
  sections: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(160),
        body: z.string().max(100_000),
        position: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  reason: z.string().trim().min(1).max(200).default('Manual edit'),
});

export const sessionProviderSchema = z.object({
  apiKey: z.string().trim().min(1).max(10_000).optional(),
  baseUrl: z.string().trim().url().max(2048).optional(),
  headers: z.record(z.string(), z.string().max(4096)).optional(),
});

export const aiActionSchema = z
  .object({
    projectId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    action: z.enum(aiActions),
    scope: z.enum(actionScopes),
    provider: z.enum(providerKinds),
    model: z.string().trim().min(1).max(300),
    targetSectionId: z.string().uuid().optional(),
    selection: z.string().max(50_000).optional(),
    instruction: z.string().trim().max(10_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.scope !== 'document' && !value.targetSectionId) {
      context.addIssue({
        code: 'custom',
        path: ['targetSectionId'],
        message: 'A target section is required for section and selection scopes.',
      });
    }
    if (value.scope === 'selection' && !value.selection?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['selection'],
        message: 'Selected text is required for selection scope.',
      });
    }
  });

export const applyAiRunSchema = z.object({
  revision: z.number().int().nonnegative(),
  proposedMarkdown: z.string().max(500_000).optional(),
});

export const acceptFindingSchema = z.object({
  revision: z.number().int().nonnegative(),
  proposedMarkdown: z.string().max(100_000).optional(),
});

export const restoreRevisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
});

export type AiActionRequest = z.infer<typeof aiActionSchema>;

export const reviewFindingOutputSchema = z.object({
  category: z.enum(findingCategories),
  severity: z.enum(severityLevels),
  targetSectionId: z.string(),
  rationale: z.string().min(1).max(1200),
  citationChunkIds: z.array(z.string()).max(8),
  proposedMarkdown: z.string().max(8000).nullable(),
});

export const reviewOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  findings: z.array(reviewFindingOutputSchema).max(20),
});

export const reviewGenerationSchema = z.object({
  summary: z.string(),
  findings: z
    .array(
      z.object({
        category: z.enum(findingCategories),
        severity: z.enum(severityLevels),
        targetSectionId: z.string(),
        rationale: z.string(),
        citationChunkIds: z.array(z.string()).max(8),
        proposedMarkdown: z.string().nullable(),
      }),
    )
    .max(20),
});

export const DEFAULT_SECTIONS = [
  'Problem',
  'Context',
  'Target users',
  'Goals',
  'Non-goals',
  'Scope',
  'User journeys',
  'Requirements and acceptance criteria',
  'Success measures',
  'Dependencies',
  'Risks',
  'Open questions',
  'Rollout',
] as const;
