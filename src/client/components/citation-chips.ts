import { Extension } from '@tiptap/core';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { splitCitations } from '@/lib/citations';

// Shows stored "[chunk-id]" citation markers as numbered chips. The marker text
// stays in the document so saving and provenance checks are unchanged, but the
// caret never rests inside a marker and deleting next to a chip removes it whole.
interface MarkerRange {
  from: number;
  to: number;
}
interface ChipState {
  decorations: DecorationSet;
  ranges: MarkerRange[];
}

function scan(doc: ProseMirrorNode): ChipState {
  const decorations: Decoration[] = [];
  const ranges: MarkerRange[] = [];
  const numbers = new Map<string, number>();
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    let offset = 0;
    for (const part of splitCitations(node.text, numbers)) {
      if (typeof part === 'string') {
        offset += part.length;
        continue;
      }
      const from = position + offset;
      const to = from + part.marker.length;
      for (const id of part.marker.slice(1, -1).split(/[,;]/)) {
        const key = id.trim().toLowerCase();
        if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
      }
      const label = part.numbers.join(', ');
      ranges.push({ from, to });
      decorations.push(
        Decoration.inline(from, to, { class: 'cite-marker' }),
        Decoration.widget(
          to,
          () => {
            const chip = document.createElement('span');
            chip.className = 'chip-cite';
            chip.textContent = label;
            chip.setAttribute('aria-label', `Source ${label}`);
            chip.contentEditable = 'false';
            return chip;
          },
          { side: 1, key: `cite-${from}-${label}` },
        ),
      );
      offset += part.marker.length;
    }
  });
  return { decorations: DecorationSet.create(doc, decorations), ranges };
}

const key = new PluginKey<ChipState>('citationChips');

function deleteWholeMarker(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  backward: boolean,
) {
  const { selection } = state;
  if (!selection.empty) return false;
  const target = key
    .getState(state)
    ?.ranges.find((range) => (backward ? range.to : range.from) === selection.from);
  if (!target) return false;
  dispatch(state.tr.delete(target.from, target.to));
  return true;
}

export const CitationChips = Extension.create({
  name: 'citationChips',
  // Runs before the default Backspace and Delete handling.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => deleteWholeMarker(editor.state, editor.view.dispatch, true),
      Delete: ({ editor }) => deleteWholeMarker(editor.state, editor.view.dispatch, false),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<ChipState>({
        key,
        state: {
          init: (_, { doc }) => scan(doc),
          apply: (transaction, value) => (transaction.docChanged ? scan(transaction.doc) : value),
        },
        appendTransaction(_transactions, _old, state) {
          const { selection } = state;
          if (!selection.empty) return null;
          const inside = key
            .getState(state)
            ?.ranges.find((range) => selection.from > range.from && selection.from < range.to);
          return inside ? state.tr.setSelection(TextSelection.create(state.doc, inside.to)) : null;
        },
        props: {
          decorations(state) {
            return key.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
