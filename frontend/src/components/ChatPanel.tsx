import { useState, useRef, useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X, Send, FileText } from "lucide-react";
import { sendChatMessage, ChatSource } from "../api";

interface Props {
  onClose: () => void;
  onSelectFile: (fileId: number) => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  isStreaming?: boolean;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return tokens.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={idx}
          className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[12px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function renderBasicMarkdown(content: string): ReactNode {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    const ordered: string[] = [];
    while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
      ordered.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
      i += 1;
    }
    if (ordered.length) {
      blocks.push(
        <ol key={`ol-${i}`} className="m-0 mb-2 pl-5 list-decimal">
          {ordered.map((item, idx) => (
            <li key={idx} className="mb-1">{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const bullets: string[] = [];
    while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
      bullets.push(lines[i].trim().replace(/^[-*]\s+/, ""));
      i += 1;
    }
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${i}`} className="m-0 mb-2 pl-5 list-disc">
          {bullets.map((item, idx) => (
            <li key={idx} className="mb-1">{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    blocks.push(
      <p key={`p-${i}`} className="m-0 mb-2 last:mb-0">
        {renderInlineMarkdown(lines[i])}
      </p>,
    );
    i += 1;
  }

  return <>{blocks}</>;
}

export function ChatPanel({ onClose, onSelectFile }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [MarkdownRenderer, setMarkdownRenderer] = useState<
    null | ((props: { children: string }) => React.ReactNode)
  >(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let mounted = true;
    // Load react-markdown only when available in node_modules.
    const loadMarkdown = async () => {
      try {
        const importer = new Function(
          "m",
          "return import(m)",
        ) as (m: string) => Promise<any>;
        const mod = await importer("react-markdown");
        if (!mounted) return;
        const Cmp = mod.default;
        setMarkdownRenderer(() => ({ children }: { children: string }) =>
          Cmp({
            children,
            components: {
              p: ({ children }: any) => (
                <p className="m-0 mb-2 last:mb-0">{children}</p>
              ),
              ul: ({ children }: any) => (
                <ul className="m-0 mb-2 pl-5 list-disc">{children}</ul>
              ),
              ol: ({ children }: any) => (
                <ol className="m-0 mb-2 pl-5 list-decimal">{children}</ol>
              ),
              li: ({ children }: any) => <li className="mb-1">{children}</li>,
              strong: ({ children }: any) => (
                <strong className="font-semibold">{children}</strong>
              ),
              code: ({ children }: any) => (
                <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[12px] font-mono">
                  {children}
                </code>
              ),
            },
          }),
        );
      } catch {
        // Fallback to plain text rendering when dependency is unavailable.
      }
    };
    void loadMarkdown();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setIsLoading(true);

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    // Add placeholder assistant message
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", isStreaming: true },
    ]);

    await sendChatMessage(
      text,
      // onSources
      (files) => {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 && m.role === "assistant"
              ? { ...m, sources: files }
              : m,
          ),
        );
      },
      // onToken
      (token) => {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 && m.role === "assistant"
              ? { ...m, content: m.content + token }
              : m,
          ),
        );
      },
      // onDone
      () => {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 && m.role === "assistant"
              ? { ...m, isStreaming: false }
              : m,
          ),
        );
        setIsLoading(false);
      },
      // onError
      (err) => {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 && m.role === "assistant"
              ? { ...m, content: `Error: ${err}`, isStreaming: false }
              : m,
          ),
        );
        setIsLoading(false);
      },
    );
  };

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 400, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="h-full border-l border-bg-border bg-bg-card flex flex-col overflow-hidden shrink-0 z-30"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border shrink-0">
        <h3 className="font-semibold text-sm text-text-primary">
          Chat with Files
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-bg-dark text-text-tertiary cursor-pointer border-none bg-transparent"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-text-tertiary">
            <div className="w-12 h-12 rounded-2xl bg-bg-dark flex items-center justify-center mb-3">
              <FileText size={20} className="text-text-tertiary" />
            </div>
            <p className="text-sm font-medium text-text-secondary mb-1">
              Ask about your files
            </p>
            <p className="text-xs leading-relaxed max-w-[260px]">
              Try: "What are my files about?", "Summarize the PDFs", "Find
              documents about cooking"
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {/* Message bubble */}
            <div
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-accent-light text-text-primary rounded-br-md"
                    : "bg-bg-dark text-text-primary rounded-bl-md"
                }`}
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {msg.role === "assistant" && MarkdownRenderer ? (
                  <MarkdownRenderer>{msg.content}</MarkdownRenderer>
                ) : msg.role === "assistant" ? (
                  renderBasicMarkdown(msg.content)
                ) : (
                  msg.content
                )}
                {msg.isStreaming && !msg.content && (
                  <span className="typing-indicator">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                )}
              </div>
            </div>

            {/* Source pills */}
            {msg.sources && msg.sources.length > 0 && (
              <div
                className={`flex flex-wrap gap-1.5 mt-1.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.sources.map((src) => (
                  <button
                    key={src.file_id}
                    onClick={() => onSelectFile(src.file_id)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] cursor-pointer border-none bg-bg-dark hover:bg-bg-border text-text-secondary transition-colors"
                    title={src.summary}
                  >
                    <FileText size={10} />
                    {src.filename}
                    <span
                      className="px-1 py-0 rounded text-[9px] font-mono"
                      style={{
                        background: "var(--accent-light)",
                        color: "var(--accent)",
                      }}
                    >
                      {(src.score * 100).toFixed(0)}%
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-bg-border shrink-0">
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{
            background: "var(--bg-dark)",
            border: "1px solid var(--bg-border)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask about your files..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className={`w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer border-none transition-colors ${
              isLoading || !input.trim()
                ? "bg-transparent text-text-tertiary cursor-default"
                : "bg-accent text-white hover:bg-accent-hover"
            }`}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
