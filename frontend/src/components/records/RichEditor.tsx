import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, RemoveFormatting } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface RichEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export default function RichEditor({
  content,
  onChange,
  placeholder = "AI 潤飾結果將顯示於此，你可以直接編輯...",
}: RichEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
  });

  // Sync external content changes (e.g. from AI refine)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) return null;

  const charCount = editor.storage.characterCount?.characters?.() ?? editor.getText().length;

  return (
    <div className="rounded-xl border border-gray-200 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/10 transition-all">
      {/* Toolbar */}
      <div className="flex gap-0.5 border-b border-gray-100 p-1.5">
        <ToolbarBtn
          icon={Bold}
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="粗體"
        />
        <ToolbarBtn
          icon={Italic}
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="斜體"
        />
        <ToolbarBtn
          icon={List}
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="條列清單"
        />
        <div className="mx-1 w-px bg-gray-100" />
        <ToolbarBtn
          icon={RemoveFormatting}
          active={false}
          onClick={() =>
            editor.chain().focus().clearNodes().unsetAllMarks().run()
          }
          title="清除格式"
        />
      </div>

      {/* Editor */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none p-3 min-h-[200px] focus:outline-none [&_.tiptap]:outline-none [&_.tiptap]:min-h-[180px] [&_.is-editor-empty:first-child::before]:text-gray-400 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:pointer-events-none"
      />

      {/* Char count */}
      <div className="border-t border-gray-100 px-3 py-1.5 text-right text-xs text-gray-400">
        {charCount} 字
      </div>
    </div>
  );
}

function ToolbarBtn({
  icon: Icon,
  active,
  onClick,
  title,
}: {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        active
          ? "bg-primary-50 text-primary-700"
          : "text-gray-400 hover:bg-surface-100 hover:text-gray-600"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
