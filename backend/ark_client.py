"""火山方舟 + Viking 知识库 客户端.

- 对话: httpx 直连 ARK OpenAI 兼容接口 (Bearer ARK_API_KEY)
- 知识库检索/文档列表/文档注册: 官方 volcengine.viking_knowledgebase SDK
  (通过 viking_kb.build_kb_service 注入 Bearer VIKING_API_KEY)
- 上传流程: 浏览器把文件 PUT 到 TOS (由 tos_client 出 presign URL),
  再调 register_tos_document 让 Viking 用 add_type='tos' 把 tos_path 收进 KB.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator, Iterable

import httpx

from config import settings
from viking_kb import build_kb_service


class ArkClient:
    def __init__(self) -> None:
        self._chat_client = httpx.AsyncClient(
            base_url=settings.ARK_BASE_URL,
            headers={
                "Authorization": f"Bearer {settings.ARK_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(60.0, read=None),
        )
        self._kb = build_kb_service(
            api_key=settings.VIKING_API_KEY,
            host=settings.ARK_KB_BASE_URL.replace("https://", "").replace("http://", ""),
        )

    async def close(self) -> None:
        await self._chat_client.aclose()

    # ---------- 知识库 ----------
    async def register_tos_document(
        self,
        tos_path: str,
        doc_id: str,
        doc_name: str,
        doc_type: str,
    ) -> dict:
        """把已经躺在 TOS 里的文件登记进 Viking KB."""

        params = {
            "collection_name": settings.ARK_KB_COLLECTION_NAME,
            "project": settings.ARK_KB_PROJECT,
            "add_type": "tos",
            "tos_path": tos_path,
            "doc_id": doc_id,
            "doc_name": doc_name,
            "doc_type": doc_type,
        }
        if settings.ARK_KB_RESOURCE_ID:
            params["resource_id"] = settings.ARK_KB_RESOURCE_ID

        def _do():
            raw = self._kb.json_exception("AddDoc", {}, json.dumps(params))
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"raw": raw}
        return await asyncio.to_thread(_do)

    async def list_documents(self) -> dict:
        # SDK 的 Collection.list_docs 在空 KB 下会 KeyError('doc_list'),
        # 走底层 json_exception 自己解.
        def _do():
            raw = self._kb.json_exception(
                "ListDocs",
                {},
                json.dumps(
                    {
                        "collection_name": settings.ARK_KB_COLLECTION_NAME,
                        "project": settings.ARK_KB_PROJECT,
                        "offset": 0,
                        "limit": 100,
                        "doc_type": None,
                        "filter": None,
                    }
                ),
            )
            data = json.loads(raw).get("data", {}) or {}
            return {
                "collection_name": data.get("collection_name"),
                "total_num": data.get("total_num", 0),
                "doc_list": data.get("doc_list", []),
            }
        return await asyncio.to_thread(_do)

    async def search_knowledge(self, query: str, top_k: int = 4) -> list[dict]:
        result = await self._kb.async_search_knowledge(
            collection_name=settings.ARK_KB_COLLECTION_NAME,
            query=query,
            project=settings.ARK_KB_PROJECT,
            limit=top_k,
            resource_id=settings.ARK_KB_RESOURCE_ID or None,
        )
        return result.get("result_list") or []

    # ---------- 对话 ----------
    async def stream_chat(
        self, messages: Iterable[dict], model: str | None = None
    ) -> AsyncIterator[str]:
        payload = {
            "model": model or settings.ARK_MODEL_ENDPOINT,
            "messages": list(messages),
            "stream": True,
        }
        async with self._chat_client.stream(
            "POST", "/chat/completions", json=payload
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content


ark_client = ArkClient()
