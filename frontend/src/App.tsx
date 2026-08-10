import { useEffect, useMemo, useRef, useState } from "react";
import {
  listDocuments,
  streamChat,
  uploadDocument,
  type Chunk,
  type DocItem,
} from "./api";

type Message = {
  role: "user" | "assistant";
  content: string;
  chunks?: Chunk[];
  streaming?: boolean;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};

type PendingUpload = {
  key: string;
  displayName: string;
  status: "uploading" | "registering";
  progress?: number;
};

const LS_CONV = "kb.conversations.v1";
const LS_CUR = "kb.currentId.v1";
const SUGGESTIONS = [
  "帮我总结上传文档的核心观点",
  "文档里提到了哪些关键人物 / 概念",
  "把文档中最重要的三段内容摘出来",
  "针对文档写一份 200 字的执行摘要",
];

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadConversations(): Conversation[] {
  try {
    const s = localStorage.getItem(LS_CONV);
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
}
function saveConversations(list: Conversation[]) {
  try {
    localStorage.setItem(LS_CONV, JSON.stringify(list));
  } catch {
    /* quota exceeded 之类, 忽略 */
  }
}
function loadCurrentId(): string | null {
  try {
    return localStorage.getItem(LS_CUR);
  } catch {
    return null;
  }
}
function saveCurrentId(id: string | null) {
  try {
    if (id) localStorage.setItem(LS_CUR, id);
    else localStorage.removeItem(LS_CUR);
  } catch {
    /* ignore */
  }
}

function firstLine(s: string, n = 22): string {
  const one = s.split("\n")[0].trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

function fileExt(name: string): string {
  const m = name.split(".").pop();
  return (m || "").toUpperCase().slice(0, 3) || "DOC";
}

// Viking 会在 doc_name 前拼一段 hex doc_id, 去掉更好看
function cleanDocName(name: string): string {
  return name.replace(/^[a-f0-9]{20,}-/, "");
}

function docStatusFromRemote(d: DocItem): {
  label: string;
  kind: "ok" | "processing" | "err" | "unknown";
} {
  const ps = d.status?.process_status;
  if (ps === 0) return { label: `${d.point_num ?? 0} 切片`, kind: "ok" };
  if (ps === 3) return { label: "失败", kind: "err" };
  if (ps === 1 || ps === 2) return { label: "切片中", kind: "processing" };
  return { label: `状态 ${ps ?? "?"}`, kind: "unknown" };
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [currentId, setCurrentId] = useState<string | null>(loadCurrentId);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [kbDocs, setKbDocs] = useState<DocItem[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 持久化
  useEffect(() => saveConversations(conversations), [conversations]);
  useEffect(() => saveCurrentId(currentId), [currentId]);

  // 保证至少有一个当前对话
  useEffect(() => {
    if (currentId && conversations.some((c) => c.id === currentId)) return;
    if (conversations.length > 0) {
      setCurrentId(conversations[0].id);
      return;
    }
    const c: Conversation = {
      id: uid(),
      title: "新对话",
      messages: [],
      updatedAt: Date.now(),
    };
    setConversations([c]);
    setCurrentId(c.id);
  }, [conversations, currentId]);

  const current = useMemo(
    () => conversations.find((c) => c.id === currentId) ?? null,
    [conversations, currentId],
  );
  const messages = current?.messages ?? [];
  const isEmpty = messages.length === 0;

  // 拉知识库文档列表, 每 5s 一次
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const list = await listDocuments();
        if (!stop) setKbDocs(list);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  // 自动滚
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

  function updateCurrent(fn: (msgs: Message[]) => Message[]) {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== currentId) return c;
        const nextMsgs = fn(c.messages);
        // 首条用户消息用来当标题
        let title = c.title;
        if (
          title === "新对话" &&
          nextMsgs.some((m) => m.role === "user")
        ) {
          const first = nextMsgs.find((m) => m.role === "user");
          if (first) title = firstLine(first.content);
        }
        return { ...c, messages: nextMsgs, updatedAt: Date.now(), title };
      }),
    );
  }

  function newConversation() {
    const c: Conversation = {
      id: uid(),
      title: "新对话",
      messages: [],
      updatedAt: Date.now(),
    };
    setConversations((prev) => [c, ...prev]);
    setCurrentId(c.id);
    setInput("");
  }

  function switchTo(id: string) {
    if (sending) return; // 生成中不切, 避免流式回调污染另一条对话
    setCurrentId(id);
  }

  async function handleSend(prompt?: string) {
    const q = (prompt ?? input).trim();
    if (!q || sending || !currentId) return;
    if (!prompt) setInput("");
    setSending(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    updateCurrent((msgs) => [
      ...msgs,
      { role: "user", content: q },
      { role: "assistant", content: "", streaming: true },
    ]);

    try {
      await streamChat(q, history, {
        onRetrieval: (chunks) => {
          updateCurrent((msgs) => {
            const next = [...msgs];
            next[next.length - 1] = { ...next[next.length - 1], chunks };
            return next;
          });
        },
        onToken: (text) => {
          updateCurrent((msgs) => {
            const next = [...msgs];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + text };
            return next;
          });
        },
        onError: (msg) => {
          updateCurrent((msgs) => {
            const next = [...msgs];
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
      updateCurrent((msgs) => {
        const next = [...msgs];
        next[next.length - 1] = { ...next[next.length - 1], streaming: false };
        return next;
      });
      setSending(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const key = uid();
    setPending((prev) => [
      ...prev,
      { key, displayName: file.name, status: "uploading", progress: 0 },
    ]);

    try {
      await uploadDocument(file, (p) => {
        setPending((prev) =>
          prev.map((x) => {
            if (x.key !== key) return x;
            if (p.stage === "put") return { ...x, progress: p.percent, status: "uploading" };
            if (p.stage === "register") return { ...x, progress: 100, status: "registering" };
            return x;
          }),
        );
      });
      // 移除 pending, 手动刷一次让新 doc 立刻出现
      setPending((prev) => prev.filter((x) => x.key !== key));
      try {
        setKbDocs(await listDocuments());
      } catch {
        /* ignore */
      }
    } catch (err) {
      const msg = (err as Error).message;
      setPending((prev) =>
        prev.map((x) =>
          x.key === key
            ? { ...x, displayName: `${x.displayName} (${msg})` }
            : x,
        ),
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">知</div>
          <div className="name">知识助手</div>
        </div>

        <button className="new-chat" onClick={newConversation}>
          <span className="plus">+</span>
          <span>新对话</span>
        </button>

        <div className="sidebar-scroll">
          <div className="sidebar-section">
            <div className="section-title">对话</div>
            <ul className="conv-list">
              {conversations.length === 0 && (
                <li className="doc-empty">开一个新对话开始</li>
              )}
              {conversations.map((c) => (
                <li
                  key={c.id}
                  className={`conv-item${c.id === currentId ? " active" : ""}`}
                  onClick={() => switchTo(c.id)}
                  title={c.title}
                >
                  {c.title || "新对话"}
                </li>
              ))}
            </ul>
          </div>

          <div className="sidebar-section">
            <div className="section-title">文档 · 知识库 test</div>
            <ul className="doc-list">
              {pending.map((p) => (
                <li className="doc" key={p.key} title={p.displayName}>
                  <div className="file-icon">{fileExt(p.displayName)}</div>
                  <div className="doc-name">{p.displayName}</div>
                  <div className="doc-status processing">
                    <span className="dot" />
                    <span>
                      {p.status === "uploading"
                        ? `${p.progress ?? 0}%`
                        : "注册中"}
                    </span>
                  </div>
                </li>
              ))}
              {kbDocs.length === 0 && pending.length === 0 && (
                <li className="doc-empty">
                  还没有文档，用输入框旁的 + 上传
                </li>
              )}
              {kbDocs.map((d) => {
                const st = docStatusFromRemote(d);
                return (
                  <li className="doc" key={d.doc_id} title={d.doc_name}>
                    <div className="file-icon">{fileExt(d.doc_name)}</div>
                    <div className="doc-name">{cleanDocName(d.doc_name)}</div>
                    <div className={`doc-status ${st.kind}`}>
                      <span className="dot" />
                      <span>{st.label}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="sidebar-footer">
          <span className="connected-dot" />
          <span>已连接 · Volc Viking KB</span>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="title">{current?.title || "对话"}</div>
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
                                    <span className="ref-idx">
                                      [{idx + 1}]
                                    </span>
                                    <span>
                                      {cleanDocName(
                                        c.doc_name ||
                                          c.source ||
                                          "未命名来源",
                                      )}
                                    </span>
                                  </div>
                                  <div className="ref-body">
                                    {c.content ||
                                      c.text ||
                                      c.chunk_content ||
                                      ""}
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
              <div className="composer-hint">
                Enter 发送 · Shift+Enter 换行
              </div>
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
