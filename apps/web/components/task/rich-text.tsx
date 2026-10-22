'use client';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListChecks, ListOrdered, Quote } from 'lucide-react';
import { cn } from '@remindora/ui';

/** Rich-text notes (Tiptap). HTML is sanitized again on the server before storage. */
export function RichText({ value, onSave, readOnly }: { value: string; onSave: (html: string) => void; readOnly?: boolean }) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), TaskList, TaskItem.configure({ nested: true }), Placeholder.configure({ placeholder: 'Add notes, links, or a checklist…' })],
    content: value,
    editorProps: { attributes: { class: 'prose-task min-h-24 text-sm leading-relaxed focus:outline-none', 'aria-label': 'Task notes', role: 'textbox', 'aria-multiline': 'true' } },
    onBlur: ({ editor }) => onSave(editor.isEmpty ? '' : editor.getHTML()),
  });
  if (!editor) return <div className="min-h-24 rounded-xl border border-line" />;
  const btn = (active: boolean) => cn('rounded-md p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink', active && 'bg-white/8 text-cyan');
  return (
    <div className="rounded-xl border border-line bg-bg-elevated/40 focus-within:border-cyan/50">
      {!readOnly && (
        <div className="flex gap-0.5 border-b border-line px-1.5 py-1" role="toolbar" aria-label="Formatting">
          <button type="button" aria-label="Bold" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></button>
          <button type="button" aria-label="Italic" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></button>
          <button type="button" aria-label="Bulleted list" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></button>
          <button type="button" aria-label="Numbered list" className={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></button>
          <button type="button" aria-label="Checklist" className={btn(editor.isActive('taskList'))} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={14} /></button>
          <button type="button" aria-label="Quote" className={btn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={14} /></button>
        </div>
      )}
      <EditorContent editor={editor} className="px-3 py-2" />
    </div>
  );
}
