import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../store/authStore";
import { useToast } from "../../contexts/ToastContext";
import api, { API_URL } from "../../api/axios";
import ChatMessage, {
  type FunctionCallDisplay,
} from "./ChatMessage";
import {
  Bot,
  Send,
  Trash2,
  X,
  PanelRightClose,
  Lightbulb,
  ChevronRight,
} from "lucide-react";

const TIPS = [
  {
    category: "查詢個案",
    items: [
      { label: "查個案資料", prompt: "幫我查陳大明的個案資料" },
      { label: "逾期個案清單", prompt: "列出所有逾期的個案" },
      { label: "順路家訪建議", prompt: "我今天要去家訪王小明，還能順便拜訪誰？" },
    ],
  },
  {
    category: "訪視紀錄",
    items: [
      { label: "建立訪視紀錄", prompt: "我要建立一筆家訪紀錄" },
      { label: "查看草稿紀錄", prompt: "目前有哪些紀錄還是草稿狀態？" },
      { label: "本月訪視統計", prompt: "請給我本月的家訪和電訪統計數字" },
    ],
  },
  {
    category: "排程管理",
    items: [
      { label: "今日訪視行程", prompt: "今天有哪些個案需要訪視？" },
      { label: "本月排程總覽", prompt: "幫我看本月的訪視排程" },
      { label: "機構總覽快照", prompt: "幫我看全機構快照" },
    ],
  },
];

interface Message {
  role: "user" | "assistant";
  content: string;
  functionCalls?: FunctionCallDisplay[];
}

interface AiContext {
  draft_count: number;
  overdue_count: number;
  due_soon_count: number;
}

function buildQuickPrompts(ctx: AiContext | null) {
  const prompts = [
    { label: "機構總覽", message: "幫我看全機構快照" },
    { label: "本月訪視統計", message: "請給我本月的家訪和電訪統計數字" },
  ];
  if (ctx?.draft_count && ctx.draft_count > 0) {
    prompts.push({
      label: `待完成紀錄（${ctx.draft_count}）`,
      message: "目前有哪些紀錄還是草稿狀態？",
    });
  }
  if (ctx?.overdue_count && ctx.overdue_count > 0) {
    prompts.push({
      label: `逾期個案（${ctx.overdue_count}）`,
      message: "列出所有逾期的個案",
    });
  } else if (ctx?.due_soon_count && ctx.due_soon_count > 0) {
    prompts.push({
      label: `即將到期（${ctx.due_soon_count}）`,
      message: "列出即將到期的個案",
    });
  }
  prompts.push({ label: "今日行程", message: "今天有哪些個案需要訪視？" });
  return prompts;
}

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "你好！我是**長照小幫手**\n\n我可以幫你：\n- 查詢個案資料\n- 查看家電訪紀錄\n- 統計訪視數據\n- 分析個案狀況\n\n請問有什麼可以幫你的嗎？",
};

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function ChatPanel({ open, onClose }: ChatPanelProps) {
  const { showToast } = useToast();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(
    localStorage.getItem("carevisit_chat_session"),
  );
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingFnCalls, setStreamingFnCalls] = useState<FunctionCallDisplay[]>([]);
  const [aiContext, setAiContext] = useState<AiContext | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showTips, setShowTips] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Load chat history from backend on first mount if session exists
  useEffect(() => {
    const storedSession = localStorage.getItem("carevisit_chat_session");
    if (!storedSession || historyLoaded) return;
    setHistoryLoaded(true);
    api.get<{ messages: { role: "user" | "assistant"; content: string }[] }>(
      `/ai/chat/history?session_id=${storedSession}`
    )
      .then((r) => {
        if (r.data.messages.length > 0) {
          setMessages([WELCOME_MESSAGE, ...r.data.messages]);
        }
      })
      .catch(() => {
        // Session may have expired — clear it
        localStorage.removeItem("carevisit_chat_session");
        setSessionId(null);
      });
  }, [historyLoaded]);

  // Focus input when panel opens + fetch context for dynamic prompts
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 350);
      api.get<AiContext>("/ai/context")
        .then((r) => setAiContext(r.data))
        .catch(() => {});
    }
  }, [open]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;

      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);
      setStreamingContent("");
      setStreamingFnCalls([]);

      try {
        const response = await fetch(`${API_URL}/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: text,
            session_id: sessionId,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let accumulated = "";
        const fnCalls: FunctionCallDisplay[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const data = JSON.parse(jsonStr);

              if (data.type === "text") {
                accumulated += data.content;
                setStreamingContent(accumulated);
              } else if (data.type === "function_call") {
                fnCalls.push({ name: data.name });
                setStreamingFnCalls([...fnCalls]);
              } else if (data.type === "function_result") {
                const last = fnCalls[fnCalls.length - 1];
                if (last) last.result = data.content;
                setStreamingFnCalls([...fnCalls]);
              } else if (data.type === "done") {
                if (data.session_id) {
                  setSessionId(data.session_id);
                  localStorage.setItem(
                    "carevisit_chat_session",
                    data.session_id,
                  );
                }
              }
            } catch {
              // skip malformed JSON
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: accumulated,
            functionCalls: fnCalls.length > 0 ? fnCalls : undefined,
          },
        ]);
        setStreamingContent("");
        setStreamingFnCalls([]);
      } catch {
        showToast("AI 回覆失敗，請重試", "error");
      } finally {
        setSending(false);
      }
    },
    [accessToken, sessionId, sending, showToast],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 避免在中文輸入法（IME）選字時觸發發送
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleClear = () => {
    setMessages([WELCOME_MESSAGE]);
    setSessionId(null);
    localStorage.removeItem("carevisit_chat_session");
  };

  const panelContent = (
    <>
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-100 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 shadow-sm">
            <Bot className="h-4.5 w-4.5 text-primary-500" />
          </div>
          <h3 className="text-sm font-bold tracking-wide text-gray-900">AI 助理</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowTips((v) => !v)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              showTips
                ? "bg-primary-100 text-primary-600"
                : "text-gray-400 hover:bg-surface-100 hover:text-gray-700"
            }`}
            title="使用說明"
          >
            <Lightbulb className="h-4 w-4" />
          </button>
          <button
            onClick={handleClear}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title="清除對話"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-100 hover:text-gray-900"
            title="收合面板"
          >
            <X className="h-4 w-4 md:hidden" />
            <PanelRightClose className="hidden h-4 w-4 md:block" />
          </button>
        </div>
      </div>

      {/* Tips panel */}
      {showTips && (
        <div className="shrink-0 overflow-y-auto border-b border-gray-100 bg-surface-50 px-4 py-3 max-h-64">
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
            AI 使用說明
          </p>
          <div className="space-y-3">
            {TIPS.map((group) => (
              <div key={group.category}>
                <p className="mb-1 text-[11px] font-semibold text-gray-500">{group.category}</p>
                <div className="space-y-1">
                  {group.items.map((tip) => (
                    <button
                      key={tip.label}
                      onClick={() => {
                        setShowTips(false);
                        sendMessage(tip.prompt);
                      }}
                      disabled={sending}
                      className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs font-medium text-gray-700 transition-all hover:border-gray-900 hover:bg-gray-900 hover:text-white disabled:opacity-50"
                    >
                      <span>{tip.label}</span>
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((msg, i) => {
          const isLastAssistant =
            !sending &&
            msg.role === "assistant" &&
            i === messages.length - 1;
          const isPreview = msg.content.includes("【預覽】");
          return (
            <ChatMessage
              key={i}
              role={msg.role}
              content={msg.content}
              functionCalls={msg.functionCalls}
              onConfirm={isLastAssistant && isPreview ? () => sendMessage("確認") : undefined}
            />
          );
        })}

        {streamingContent && (
          <ChatMessage
            role="assistant"
            content={streamingContent}
            functionCalls={
              streamingFnCalls.length > 0 ? streamingFnCalls : undefined
            }
            isStreaming
          />
        )}

        {sending && !streamingContent && (
          <div className="mb-4 flex justify-start">
            <div className="rounded-2xl rounded-tl-none bg-surface-100 px-5 py-3.5">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                  style={{ animationDelay: "0.3s" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts — dynamic based on context */}
      <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-2">
        {buildQuickPrompts(aiContext).map((p) => (
          <button
            key={p.label}
            onClick={() => sendMessage(p.message)}
            disabled={sending}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-bold text-gray-500 transition-all hover:-translate-y-0.5 hover:border-gray-900 hover:bg-gray-900 hover:text-white hover:shadow-sm disabled:hover:translate-y-0 disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex shrink-0 gap-2 border-t border-gray-100 p-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="輸入訊息..."
          rows={1}
          inputMode="text"
          enterKeyHint="send"
          className="input-base flex-1 resize-none py-2.5 text-sm"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={sending || !input.trim()}
          className="btn-primary px-3 py-2.5"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* ===== Desktop: inline slide panel ===== */}
      <div
        className={`hidden md:flex h-full flex-col border-l border-gray-200/80 bg-white overflow-hidden transition-[width,opacity] duration-300 ease-in-out ${
          open ? "w-[400px] opacity-100" : "w-0 opacity-0"
        }`}
      >
        {/* Only render inner content when open to avoid tab-focus into hidden panel */}
        {open && panelContent}
      </div>

      {/* ===== Mobile: overlay slide-in ===== */}
      <div className="md:hidden">
        {/* Backdrop */}
        <div
          className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300 ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={onClose}
        />
        {/* Panel */}
        <aside
          className={`fixed right-0 top-0 z-50 flex h-full w-full sm:w-[400px] flex-col bg-white shadow-modal transition-transform duration-300 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {panelContent}
        </aside>
      </div>
    </>
  );
}

/** Toggle button to open the chat panel — used in Layout topbar */
export function ChatToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-surface-100 hover:text-primary-600"
      title="AI 助理"
    >
      <Bot className="h-5 w-5" />
    </button>
  );
}
