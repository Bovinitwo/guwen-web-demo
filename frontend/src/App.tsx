import { useEffect, useMemo, useRef, useState } from "react";
import {
  listDocuments,
  streamChat,
  uploadDocument,
  type Chunk,
} from "./api";

type Message = {
  role: "user" | "assistant";
  content: string;
  chunks?: Chunk[];
  streaming?: boolean;
};

type UploadedDoc = {
  displayName: string;
  tosPath: string;
  status: "uploading" | "processing" | "done" | "failed";
  progress?: number;
  points?: number;
};

const SUGGESTIONS = [
  "帮我总结上传文档的核心观点",
  "文档里提到了哪些关键人物 / 概念",
  "把文档中最重要的三段内容摘出来",
  "针对文档写一份 200 字的执行摘要",
];

function fileExt(name: string): string {
  const m = name.split(".").pop();
  return (m || "").toUpperCase().slice(0, 3) || "DOC";
}

function statusLabel(d: UploadedDoc): string {
  switch (d.status) {
    case "uploading":
      return `上传中 ${d.progress ?? 0}%`;
    case "processing":
      return "切片中";
    case "done":
      return `${d.points ?? 0} 切片`;
    case "failed":
      return "失败";
  }
}

function statusClass(d: UploadedDoc): string {
  switch (d.status) {
    case "done":
      return "doc-status ok";
    case "failed":
      return "doc-status err";
    case "uploading":
    case "processing":
      return "doc-status processing";
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedDoc[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isEmpty = messages.length === 0;
  const activeUpload = useMemo(
    () => uploaded.find((d) => d.status === "uploading"),
    [uploaded],
  );

  // 消息自动滚
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // textarea 自适应高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [input]);

  // 轮询: 有 processing 的文档就每 3s 拉一次
  useEffect(() => {
    if (!uploaded.some((d) => d.status === "processing")) return;
    let stopped = false;
    const tick = async () => {
      try {
        const list = await listDocuments();
        if (stopped) return;
        setUploaded((prev) =>
          prev.map((d) => {
            if (d.status !== "processing") return d;
            const remote = list.find((r) => r.tos_path === d.tosPath);
            if (!remote) return d;
            const ps = remote.status?.process_status;
            if (ps === 0) return { ...d, status: "done", points: remote.point_num };
            if (ps === 3) return { ...d, status: "failed" };
            return d;
          }),
        );
      } catch {
        /* 忽略 */
      }
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [uploaded]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // 先塞一个 uploading 占位
    const placeholder: UploadedDoc = {
      displayName: file.name,
      tosPath: `pending://${file.name}-${Date.now()}`,
      status: "uploading",
      progress: 0,
    };
    setUploaded((prev) => [...prev, placeholder]);

    try {
      const { tos_path } = await uploadDocument(file, (p) => {
        setUploaded((prev) =>
          prev.map((d) => {
            if (d.tosPath !== placeholder.tosPath) return d;
            if (p.stage === "put") return { ...d, progress: p.percent };
            if (p.stage === "register") return { ...d, progress: 100 };
            return d;
          }),
        );
      });
      // 上传完切成 processing, 并绑正确 tosPath
      setUploaded((prev) =>
        prev.map((d) =>
          d.tosPath === placeholder.tosPath
            ? { ...d, tosPath: tos_path, status: "processing", progress: 100 }
            : d,
        ),
      );
    } catch (err) {
      const msg = (err as Error).message;
      setUploaded((prev) =>
        prev.map((d) =>
          d.tosPath === placeholder.tosPath
            ? { ...d, status: "failed", displayName: `${d.displayName} (${msg})` }
            : d,
        ),
      );
    }
  }

  async function handleSend(promptOverride?: string) {
    const q = (promptOverride ?? input).trim();
    if (!q || sending) return;
    if (!promptOverride) setInput("");
    setSending(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg: Message = { role: "user", content: q };
    const assistantMsg: Message = { role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      await streamChat(q, history, {
        onRetrieval: (chunks) => {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], chunks };
            return next;
          });
        },
        onToken: (text) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + text };
            return next;
          });
        },
        onError: (msg) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              content: (last.content || "") + `\n\n[出错] ${msg}`,
            };
            return next;
          });
        },
      });
    } finally {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], streaming: false };
        return next;
      });
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleNewChat() {
    setMessages([]);
    setInput("");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">知</div>
          <div className="name">知识助手</div>
        </div>

        <button className="new-chat" onClick={handleNewChat}>
          <span className="plus">+</span>
          <span>新对话</span>
        </button>

        <div>
          <div className="section-title">文档</div>
          <ul className="doc-list" style={{ marginTop: 8 }}>
            {uploaded.length === 0 && (
              <li className="doc-empty">还没有文档，从下面输入框旁 + 上传</li>
            )}
            {uploaded.map((d, i) => (
              <li className="doc" key={i} title={d.displayName}>
                <div className="file-icon">{fileExt(d.displayName)}</div>
                <div className="doc-name">{d.displayName}</div>
                <div className={statusClass(d)}>
                  <span className="dot" />
                  <span>{statusLabel(d)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-footer">
          <span className="connected-dot" />
          <span>已连接 · Volc Viking KB</span>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="title">对话</div>
          <div className="kb-tag">
            <span className="dot" />
            <span>知识库：test</span>
          </div>
        </div>

        <div className="messages">
          {isEmpty ? (
            <div className="empty">
              <div className="mark">知</div>
              <h1>你好，我是知识助手</h1>
              <p>上传文档后，我会基于文档内容回答你的问题。</p>
              <div className="suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => handleSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-inner">
              {messages.map((m, i) => (
                <div className={`msg ${m.role}`} key={i}>
                  {m.role === "user" ? (
                    <div className="bubble">{m.content}</div>
                  ) : (
                    <>
                      <div className="avatar">知</div>
                      <div className="content">
                        <div className="body">
                          {m.content}
                          {m.streaming && <span className="cursor" />}
                        </div>
                        {m.chunks && m.chunks.length > 0 && (
                          <details className="citations">
                            <summary>引用 {m.chunks.length} 段</summary>
                            <div className="refs">
                              {m.chunks.map((c, idx) => (
                                <div className="ref" key={idx}>
                                  <div className="ref-src">
                                    <span className="ref-idx">[{idx + 1}]</span>
                                    <span>{c.doc_name || c.source || "未命名来源"}</span>
                                  </div>
                                  <div className="ref-body">
                                    {c.content || c.text || c.chunk_content || ""}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <div className="composer">
            {activeUpload && (
              <div className="pending-file">
                <div className="file-icon">{fileExt(activeUpload.displayName)}</div>
                <span>{activeUpload.displayName}</span>
                <span className="progress">
                  · {activeUpload.progress ?? 0}%
                </span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              placeholder="向知识库提问，或按 + 上传文档"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={1}
            />
            <div className="composer-actions">
              <button
                className="icon-btn"
                title="上传文档"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 4v12M4 10h12"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="file-input"
                onChange={handleUpload}
              />
              <div className="composer-hint">Enter 发送 · Shift+Enter 换行</div>
              <button
                className="send-btn"
                onClick={() => handleSend()}
                disabled={sending || !input.trim()}
                title="发送"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 15V5M5 10l5-5 5 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
