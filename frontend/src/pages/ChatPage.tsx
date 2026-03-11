import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useToast } from "../contexts/ToastContext";
import ChatMessage, {
  type FunctionCallDisplay,
} from "../components/chat/ChatMessage";
import { Bot, Send, Trash2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  functionCalls?: FunctionCallDisplay[];
}

const QUICK_PROMPTS = [
  { label: "本月訪視統計", message: "請給我本月的家訪和電訪統計數字" },
  { label: "待完成紀錄", message: "目前有哪些紀錄還是草稿狀態？" },
  { label: "今日行程", message: "今天有哪些個案需要訪視？" },
  { label: "查詢個案", message: "請幫我查詢個案" },
];

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "你好！我是**長照小幫手**\n\n我可以幫你：\n- 查詢個案資料\n- 查看家電訪紀錄\n- 統計訪視數據\n- 分析個案狀況\n\n請問有什麼可以幫你的嗎？",
};

export default function ChatPage() {
  const { showToast } = useToast();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(
    localStorage.getItem("carevisit_chat_session"),
  );
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingFnCalls, setStreamingFnCalls] = useState<
    FunctionCallDisplay[]
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

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
        const response = await fetch("http://localhost:8000/api/ai/chat", {
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

        // Finalize
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleClear = () => {
    setMessages([WELCOME_MESSAGE]);
    setSessionId(null);
    localStorage.removeItem("carevisit_chat_session");
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col md:h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 shadow-sm">
            <Bot className="h-5 w-5 text-primary-500" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-gray-900">長照小幫手</h2>
            <p className="text-xs font-bold uppercase tracking-widest text-primary-600">AI Assistant</p>
          </div>
        </div>
        <button
          onClick={handleClear}
          className="btn-ghost text-sm font-bold gap-1.5 hover:text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
          清除對話
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6">
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            role={msg.role}
            content={msg.content}
            functionCalls={msg.functionCalls}
          />
        ))}

        {/* Streaming message */}
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

        {/* Sending indicator */}
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

      {/* Quick prompts */}
      <div className="flex flex-wrap gap-2 pb-4">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.label}
            onClick={() => sendMessage(p.message)}
            disabled={sending}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-600 transition-all hover:-translate-y-0.5 hover:border-gray-900 hover:bg-gray-900 hover:text-white hover:shadow-sm disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2 border-t border-gray-200 pt-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="輸入訊息...（Enter 送出，Shift+Enter 換行）"
          rows={1}
          inputMode="text"
          enterKeyHint="send"
          className="input-base flex-1 resize-none text-[16px] py-3"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={sending || !input.trim()}
          className="btn-primary px-4 min-h-[48px]"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
