import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search } from "lucide-react";

export interface FunctionCallDisplay {
  name: string;
  result?: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  functionCalls?: FunctionCallDisplay[];
  isStreaming?: boolean;
}

export default function ChatMessage({
  role,
  content,
  functionCalls,
  isStreaming = false,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary-500 text-gray-900 font-medium shadow-sm rounded-tr-none"
            : "bg-white border border-gray-200 text-gray-800 shadow-sm rounded-tl-none"
        }`}
      >
        {/* Function call badges */}
        {functionCalls && functionCalls.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {functionCalls.map((fc, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-xs font-bold tracking-wide text-primary-500 shadow-sm"
              >
                <Search className="h-3.5 w-3.5" />
                {friendlyFnName(fc.name)}
              </span>
            ))}
          </div>
        )}

        {/* Message content */}
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        )}

        {/* Streaming cursor */}
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-gray-400" />
        )}
      </div>
    </div>
  );
}

function friendlyFnName(name: string): string {
  const map: Record<string, string> = {
    search_cases: "搜尋個案",
    get_case_records: "查詢紀錄",
    get_statistics: "統計數據",
    get_pending_records: "待完成紀錄",
    draft_visit_summary: "訪視摘要",
  };
  return map[name] || name;
}
