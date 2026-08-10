import { createHash } from 'node:crypto';
import type { ChatGptHandoffPatch, PrdSection, SectionPatch } from '../../shared/types.js';
import { ApiError } from '../../shared/api.js';

export function buildHandoffApplication(
  current: PrdSection[],
  responsePatches: ChatGptHandoffPatch[],
  selectedPatches: Array<{ sectionId: string; afterMarkdown: string }>,
): PrdSection[] {
  const responsePatchById = new Map(responsePatches.map((patch) => [patch.sectionId, patch]));
  const selectedIds = new Set<string>();
  for (const patch of selectedPatches) {
    if (selectedIds.has(patch.sectionId) || !responsePatchById.has(patch.sectionId)) {
      throw new ApiError(400, 'invalid_patch', 'A selected handoff patch is invalid.');
    }
    selectedIds.add(patch.sectionId);
  }
  const sectionById = new Map(current.map((section) => [section.id, section]));
  for (const patch of selectedPatches) {
    const currentSection = sectionById.get(patch.sectionId);
    const responsePatch = responsePatchById.get(patch.sectionId);
    if (
      !currentSection ||
      !responsePatch ||
      sha256(currentSection.body) !== responsePatch.preimageHash
    ) {
      throw new ApiError(409, 'stale_handoff', 'A handoff target changed before acceptance.');
    }
  }
  const selectedById = new Map(
    selectedPatches.map((patch) => [patch.sectionId, patch.afterMarkdown]),
  );
  return current.map((section) => ({
    ...section,
    body: selectedById.get(section.id) ?? section.body,
  }));
}

export function buildFindingApplication(
  current: PrdSection[],
  patch: SectionPatch,
  proposedMarkdown?: string,
): PrdSection[] {
  const target = current.find((section) => section.id === patch.sectionId);
  if (!target || target.body !== patch.beforeMarkdown) {
    throw new ApiError(409, 'stale_finding', 'The target section changed after this review.');
  }
  return current.map((section) =>
    section.id === patch.sectionId
      ? { ...section, body: proposedMarkdown ?? patch.afterMarkdown }
      : section,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
