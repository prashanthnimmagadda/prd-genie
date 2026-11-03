export type Destination =
  'conversation' | 'document' | 'sources' | 'history' | 'structures' | 'settings';

export const destinationTitles: Record<Destination, string> = {
  conversation: 'Conversation',
  document: 'Document',
  sources: 'Sources',
  history: 'History',
  structures: 'Structures',
  settings: 'AI settings',
};
