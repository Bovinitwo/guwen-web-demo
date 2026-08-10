from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ark_client import ark_client
from config import settings
from tos_client import tos_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await ark_client.close()


app = FastAPI(title="知识助手", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str
    history: list[dict] = []  # [{role: user|assistant, content: str}]


class PresignRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"


class RegisterRequest(BaseModel):
    tos_path: str
    doc_id: str
    doc_name: str
    doc_type: str  # pdf / txt / md / docx ...


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "kb": settings.ARK_KB_COLLECTION_NAME}


@app.post("/api/upload/presign")
async def upload_presign(req: PresignRequest) -> dict:
    if not settings.TOS_BUCKET:
        raise HTTPException(500, "TOS_BUCKET not configured")
    try:
        r = tos_client.presign_put(filename=req.filename, content_type=req.content_type)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"presign failed: {e}") from e
    return {
        "put_url": r.put_url,
        "tos_path": r.tos_path,
        "object_key": r.object_key,
        "doc_id": r.doc_id,
        "expires_in": r.expires_in,
        "content_type": req.content_type,
    }


@app.post("/api/upload/register")
async def upload_register(req: RegisterRequest) -> dict:
    if not settings.ARK_KB_COLLECTION_NAME:
        raise HTTPException(500, "ARK_KB_COLLECTION_NAME not configured")
    try:
        result = await ark_client.register_tos_document(
            tos_path=req.tos_path,
            doc_id=req.doc_id,
            doc_name=req.doc_name,
            doc_type=req.doc_type,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"register failed: {e}") from e
    return {"ok": True, "doc_id": req.doc_id, "result": result}


@app.get("/api/documents")
async def documents() -> dict:
    try:
        return await ark_client.list_documents()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"list failed: {e}") from e


def _build_messages(question: str, history: list[dict], chunks: list[dict]) -> list[dict]:
    context_lines: list[str] = []
    for i, c in enumerate(chunks, 1):
        # chunk 结构因版本而异
        text = c.get("content") or c.get("text") or c.get("chunk_content") or ""
        source = c.get("doc_name") or c.get("source") or c.get("original_question") or ""
        if not text:
            continue
        context_lines.append(f"[{i}] 来源: {source}\n{text}")
    context_block = "\n\n".join(context_lines) if context_lines else "（暂无检索结果）"

    system = (
        "你是一个基于给定文档回答问题的助手。"
        "请只使用下方【参考资料】中的内容作答；"
        "若资料不足以回答，请明确说明并简要说明缺失什么。"
        "回答请标注引用编号，例如 [1][2]。\n\n"
        f"【参考资料】\n{context_block}"
    )

    messages: list[dict] = [{"role": "system", "content": system}]
    for h in history[-8:]:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and isinstance(content, str):
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})
    return messages


@app.post("/api/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    if not settings.ARK_MODEL_ENDPOINT:
        raise HTTPException(500, "ARK_MODEL_ENDPOINT not configured")

    async def event_stream():
        # 1. 检索
        try:
            chunks = await ark_client.search_knowledge(req.question, top_k=4)
        except Exception as e:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'stage': 'search', 'msg': str(e)})}\n\n"
            return

        yield f"event: retrieval\ndata: {json.dumps({'chunks': chunks}, ensure_ascii=False)}\n\n"

        # 2. 流式对话
        messages = _build_messages(req.question, req.history, chunks)
        try:
            async for delta in ark_client.stream_chat(messages):
                yield f"event: token\ndata: {json.dumps({'text': delta}, ensure_ascii=False)}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'stage': 'chat', 'msg': str(e)})}\n\n"
            return

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
