import { useEffect, useRef, useState } from "react";
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
};

type UploadedDoc = {
  displayName: string;
  tosPath: string;
  status: "processing" | "done" | "failed";
  points?: number;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploaded, setUploaded] = useState<UploadedDoc[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 轮询: 只要有 processing 的文档就每 3s 拉一次 /api/documents
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
        /* 忽略单次失败, 下一轮再试 */
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
    if (!file) return;
    try {
      const { tos_path } = await uploadDocument(file, (p) => {
        if (p.stage === "presign") setUploadStatus(`${file.name}: 申请上传地址…`);
        else if (p.stage === "put") setUploadStatus(`${file.name}: 上传中 ${p.percent}%`);
        else if (p.stage === "register") setUploadStatus(`${file.name}: 注册到知识库…`);
        else if (p.stage === "done") setUploadStatus(`${file.name}: 已入库，切片中`);
      });
      setUploaded((prev) => [
        ...prev,
        { displayName: file.name, tosPath: tos_path, status: "processing" },
      ]);
    } catch (err) {
      setUploadStatus(`上传失败: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
    }
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || sending) return;
    setInput("");
    setSending(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg: Message = { role: "user", content: q };
    const assistantMsg: Message = { role: "assistant", content: "" };
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
              content: last.content + `\n\n[错误] ${msg}`,
            };
            return next;
          });
        },
      });
    } finally {
      setSending(false);
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
        <h2>文档</h2>
        <label className="upload">
          点击上传文档
          <br />
          <span style={{ fontSize: 11, color: "#a1a1aa" }}>
            支持 PDF / TXT / MD / DOCX
          </span>
          <input type="file" onChange={handleUpload} />
        </label>
        {uploadStatus && <div className="upload-status">{uploadStatus}</div>}
        {uploaded.length > 0 && (
          <ul className="doc-list">
            {uploaded.map((d, i) => (
              <li key={i}>
                {d.displayName}
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    color:
                      d.status === "done"
                        ? "#10b981"
                        : d.status === "failed"
                        ? "#ef4444"
                        : "#a1a1aa",
                  }}
                >
                  {d.status === "done"
                    ? `✓ ${d.points ?? 0} 切片`
                    : d.status === "failed"
                    ? "✗ 失败"
                    : "切片中…"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <div className="empty">先上传一份文档，再来提问～</div>
          )}
          {messages.map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              <div className="role">{m.role === "user" ? "我" : "助手"}</div>
              <div className="bubble">{m.content || (m.role === "assistant" ? "…" : "")}</div>
              {m.chunks && m.chunks.length > 0 && (
                <div className="citations">
                  <details>
                    <summary>引用 {m.chunks.length} 段</summary>
                    {m.chunks.map((c, idx) => (
                      <pre key={idx}>
                        [{idx + 1}] {c.doc_name || c.source || ""}
                        {"\n"}
                        {c.content || c.text || c.chunk_content || ""}
                      </pre>
                    ))}
                  </details>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="composer">
          <textarea
            placeholder="就上传的文档提问... (Enter 发送，Shift+Enter 换行)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button onClick={handleSend} disabled={sending || !input.trim()}>
            {sending ? "生成中" : "发送"}
          </button>
        </div>
      </main>
    </div>
  );
}
