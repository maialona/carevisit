import { useMemo } from "react";
import { diffWords } from "diff";

interface DiffViewProps {
  oldText: string;
  newHtml: string;
}

/** Strip HTML tags and normalize whitespace for plain-text diffing. */
function htmlToPlain(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

export default function DiffView({ oldText, newHtml }: DiffViewProps) {
  const parts = useMemo(() => {
    const plainOld = oldText.replace(/\s+/g, " ").trim();
    const plainNew = htmlToPlain(newHtml);
    return diffWords(plainOld, plainNew);
  }, [oldText, newHtml]);

  if (!oldText.trim() && !newHtml.trim()) {
    return (
      <div className="p-4 text-sm text-gray-400 italic">
        尚無內容可比對
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-4 mb-3 text-xs font-medium text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-red-100 border border-red-300" />
          原始粗稿
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-emerald-100 border border-emerald-300" />
          AI 潤飾
        </span>
      </div>
      <div className="prose prose-sm max-w-none leading-relaxed whitespace-pre-wrap">
        {parts.map((part, i) => {
          if (part.removed) {
            return (
              <span
                key={i}
                className="bg-red-100 text-red-800 line-through decoration-red-400/60"
              >
                {part.value}
              </span>
            );
          }
          if (part.added) {
            return (
              <span key={i} className="bg-emerald-100 text-emerald-800">
                {part.value}
              </span>
            );
          }
          return <span key={i}>{part.value}</span>;
        })}
      </div>
    </div>
  );
}
