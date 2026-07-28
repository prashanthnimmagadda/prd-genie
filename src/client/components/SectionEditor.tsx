import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { Bold, Code, List, ListOrdered, Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SectionEditorProps {
  sectionId: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onSelectionChange: (value: string) => void;
}

export function SectionEditor({
  sectionId,
  value,
  onChange,
  onFocus,
  onSelectionChange,
}: SectionEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Markdown,
      Placeholder.configure({ placeholder: 'Add decisions, constraints, and measurable detail.' }),
    ],
    content: value,
    contentType: 'markdown',
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
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      onSelectionChange(from === to ? '' : current.state.doc.textBetween(from, to, ' '));
    },
  });

  useEffect(() => {
    if (editor && editor.getMarkdown() !== value) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return <div className="editor-loading" aria-label="Loading editor" />;

  const controls = [
    {
      label: 'Bold',
      icon: Bold,
      active: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Inline code',
      icon: Code,
      active: editor.isActive('code'),
      action: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: 'Bulleted list',
      icon: List,
      active: editor.isActive('bulletList'),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: ListOrdered,
      active: editor.isActive('orderedList'),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ] as const;

  return (
    <div className="section-editor" onFocus={onFocus}>
      <div className="editor-toolbar" aria-label="Text formatting">
        {controls.map(({ label, icon: Icon, active, action }) => (
          <Button
            key={label}
            type="button"
            variant={active ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            onClick={action}
          >
            <Icon aria-hidden="true" />
          </Button>
        ))}
        <span className="toolbar-spacer" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Undo editor change"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Redo editor change"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 aria-hidden="true" />
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
