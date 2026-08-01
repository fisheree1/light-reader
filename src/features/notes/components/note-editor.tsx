import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Bold, Heading2, Italic, List } from 'lucide-react';
import { useMemo } from 'react';

import { IconButton } from '../../../components/ui/icon-button';
import {
  createNoteDocument,
  type BookQuoteReference,
  type Note,
  type NoteDocument,
} from '../domain/note';
import { createNoteExtensions } from '../editor/note-extensions';

interface NoteEditorProps {
  note: Note;
  onChange: (document: NoteDocument) => void;
  onFlush: () => void;
  onNavigate: (reference: BookQuoteReference) => void;
  resolveBookTitle: (bookId: string) => string;
}

export function NoteEditor({
  note,
  onChange,
  onFlush,
  onNavigate,
  resolveBookTitle,
}: NoteEditorProps) {
  const extensions = useMemo(
    () => createNoteExtensions({ onNavigate, resolveBookTitle }),
    [onNavigate, resolveBookTitle],
  );
  const editor = useEditor(
    {
      extensions,
      content: note.document.content,
      editorProps: {
        attributes: {
          'aria-label': '笔记正文',
          class:
            'tiptap min-h-[24rem] px-6 py-5 leading-7 outline-none focus-visible:ring-2 focus-visible:ring-primary',
          role: 'textbox',
        },
      },
      onBlur: onFlush,
      onUpdate: ({ editor: currentEditor }) => {
        onChange(createNoteDocument(currentEditor.getJSON()));
      },
    },
    [extensions],
  );

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor.isActive('bold'),
      bulletList: currentEditor.isActive('bulletList'),
      canBold: currentEditor.can().chain().focus().toggleBold().run(),
      canBulletList: currentEditor
        .can()
        .chain()
        .focus()
        .toggleBulletList()
        .run(),
      canHeading: currentEditor
        .can()
        .chain()
        .focus()
        .toggleHeading({ level: 2 })
        .run(),
      canItalic: currentEditor.can().chain().focus().toggleItalic().run(),
      heading: currentEditor.isActive('heading', { level: 2 }),
      italic: currentEditor.isActive('italic'),
    }),
  });

  return (
    <div className="bg-background min-h-0 flex-1 overflow-auto rounded-lg border">
      <div
        aria-label="笔记格式工具栏"
        className="bg-surface sticky top-0 z-10 flex items-center gap-1 border-b p-2"
        role="toolbar"
      >
        <IconButton
          aria-pressed={toolbar.bold}
          disabled={!toolbar.canBold}
          icon={<Bold aria-hidden="true" size={16} />}
          label="粗体"
          onClick={() => {
            editor.chain().focus().toggleBold().run();
          }}
          variant="ghost"
        />
        <IconButton
          aria-pressed={toolbar.italic}
          disabled={!toolbar.canItalic}
          icon={<Italic aria-hidden="true" size={16} />}
          label="斜体"
          onClick={() => {
            editor.chain().focus().toggleItalic().run();
          }}
          variant="ghost"
        />
        <IconButton
          aria-pressed={toolbar.heading}
          disabled={!toolbar.canHeading}
          icon={<Heading2 aria-hidden="true" size={16} />}
          label="二级标题"
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          }}
          variant="ghost"
        />
        <IconButton
          aria-pressed={toolbar.bulletList}
          disabled={!toolbar.canBulletList}
          icon={<List aria-hidden="true" size={16} />}
          label="无序列表"
          onClick={() => {
            editor.chain().focus().toggleBulletList().run();
          }}
          variant="ghost"
        />
        <span className="text-muted-foreground ml-auto px-2 text-xs">
          支持 Markdown 快捷输入
        </span>
      </div>

      {note.documentRecovered ? (
        <p
          className="border-destructive/30 bg-muted text-destructive m-3 rounded-md border px-3 py-2 text-sm"
          role="alert"
        >
          原笔记内容无法读取，已安全打开空白文档；保存前请确认内容。
        </p>
      ) : null}

      <EditorContent editor={editor} />
    </div>
  );
}
