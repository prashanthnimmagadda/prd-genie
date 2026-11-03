import { useEffect, useLayoutEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { CitationChips } from './citation-chips';
import { unescapeCitationMarkers } from '@/lib/citations';

interface SectionEditorProps {
  sectionId: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onSelectionChange: (value: string) => void;
  onReady: (sectionId: string, editor: Editor | null) => void;
}

export function SectionEditor({
  sectionId,
  value,
  placeholder,
  disabled = false,
  onChange,
  onFocus,
  onSelectionChange,
  onReady,
}: SectionEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Markdown,
      Placeholder.configure({ placeholder }),
      CitationChips,
    ],
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'section-prose',
        'aria-label': 'Section content',
        role: 'textbox',
        'aria-multiline': 'true',
        'data-section-id': sectionId,
      },
    },
    onFocus,
    onUpdate: ({ editor: current }) => onChange(unescapeCitationMarkers(current.getMarkdown())),
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      onSelectionChange(from === to ? '' : current.state.doc.textBetween(from, to, ' '));
    },
    onBlur: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      if (from === to) onSelectionChange('');
    },
  });

  useEffect(() => {
    if (editor && unescapeCitationMarkers(editor.getMarkdown()) !== value) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }
  }, [editor, value]);

  useLayoutEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);

  useEffect(() => {
    onReady(sectionId, editor);
    return () => onReady(sectionId, null);
  }, [editor, sectionId, onReady]);

  if (!editor) return <div className="editor-loading" aria-label="Loading editor" />;
  return <EditorContent editor={editor} />;
}
