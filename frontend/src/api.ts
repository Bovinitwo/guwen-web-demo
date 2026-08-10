export type Chunk = {
  content?: string;
  text?: string;
  chunk_content?: string;
  doc_name?: string;
  source?: string;
  original_question?: string;
};

export type DocItem = {
  doc_id: string;
  doc_name: string;
  doc_type: string;
  tos_path?: string;
  point_num?: number;
  status?: { process_status: number };
};

export async function listDocuments(): Promise<DocItem[]> {
  const resp = await fetch("/api/documents");
  if (!resp.ok) throw new Error(`documents ${resp.status}`);
  const data = await resp.json();
  return data.doc_list || [];
}

type PresignResp = {
  put_url: string;
  tos_path: string;
  object_key: string;
  doc_id: string;
  expires_in: number;
  content_type: string;
};

function guessDocType(filename: string, mime: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && ["pdf", "txt", "md", "docx", "doc", "html", "htm"].includes(ext)) {
    return ext === "htm" ? "html" : ext === "doc" ? "docx" : ext;
  }
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("markdown")) return "md";
  if (mime.includes("word") || mime.includes("officedocument.word")) return "docx";
  return "txt";
}

export type UploadProgress =
  | { stage: "presign" }
  | { stage: "put"; percent: number }
  | { stage: "register" }
  | { stage: "done"; doc_id: string };

export async function uploadDocument(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ doc_id: string; tos_path: string }> {
  onProgress?.({ stage: "presign" });
  const contentType = file.type || "application/octet-stream";

  const presignResp = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, content_type: contentType }),
  });
  if (!presignResp.ok) {
    throw new Error(`presign ${presignResp.status}: ${await presignResp.text()}`);
  }
  const { put_url, tos_path, doc_id }: PresignResp = await presignResp.json();

  onProgress?.({ stage: "put", percent: 0 });
  await putToTOS(put_url, file, contentType, (percent) =>
    onProgress?.({ stage: "put", percent }),
  );

  onProgress?.({ stage: "register" });
  const registerResp = await fetch("/api/upload/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tos_path,
      doc_id,
      doc_name: file.name,
      doc_type: guessDocType(file.name, contentType),
    }),
  });
  if (!registerResp.ok) {
    throw new Error(`register ${registerResp.status}: ${await registerResp.text()}`);
  }
  onProgress?.({ stage: "done", doc_id });
  return { doc_id, tos_path };
}

function putToTOS(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`PUT tos ${xhr.status}: ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error("PUT tos network error"));
    xhr.send(file);
  });
}

export type StreamHandlers = {
  onRetrieval?: (chunks: Chunk[]) => void;
  onToken?: (text: string) => void;
  onError?: (msg: string) => void;
  onDone?: () => void;
};

export async function streamChat(
  question: string,
  history: { role: string; content: string }[],
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    handlers.onError?.(`HTTP ${resp.status}`);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const evt = parseSSE(raw);
      if (!evt) continue;
      if (evt.event === "retrieval") {
        try {
          const payload = JSON.parse(evt.data);
          handlers.onRetrieval?.(payload.chunks || []);
        } catch {
          /* ignore */
        }
      } else if (evt.event === "token") {
        try {
          const payload = JSON.parse(evt.data);
          if (payload.text) handlers.onToken?.(payload.text);
        } catch {
          /* ignore */
        }
      } else if (evt.event === "error") {
        try {
          const payload = JSON.parse(evt.data);
          handlers.onError?.(payload.msg || "unknown error");
        } catch {
          handlers.onError?.(evt.data);
        }
      } else if (evt.event === "done") {
        handlers.onDone?.();
      }
    }
  }
}

function parseSSE(block: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join("\n") };
}
