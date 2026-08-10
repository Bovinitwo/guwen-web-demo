"""TOS 对象存储客户端: 为浏览器直传生成 presigned PUT URL."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import NamedTuple

import tos

from config import settings


class PresignResult(NamedTuple):
    put_url: str
    tos_path: str            # 交给 Viking add_doc(add_type='tos') 用的完整 tos:// 路径
    object_key: str          # 桶内 key
    doc_id: str              # 用作 Viking 的 doc_id
    expires_in: int


class TosClient:
    def __init__(self) -> None:
        # tos SDK 接受两种 endpoint 写法, 这里都规范成不带 scheme.
        endpoint = settings.TOS_ENDPOINT.replace("https://", "").replace("http://", "").strip("/")
        self._client = tos.TosClientV2(
            ak=settings.TOS_ACCESS_KEY_ID,
            sk=settings.TOS_SECRET_ACCESS_KEY,
            endpoint=endpoint,
            region=settings.TOS_REGION,
        )
        self._bucket = settings.TOS_BUCKET

    def presign_put(
        self,
        filename: str,
        content_type: str,
        prefix: str = "guwen-kb",
        expires_in: int = 900,
    ) -> PresignResult:
        doc_id = uuid.uuid4().hex
        safe_name = filename.replace("/", "_")
        date_prefix = datetime.utcnow().strftime("%Y/%m/%d")
        object_key = f"{prefix}/{date_prefix}/{doc_id}-{safe_name}"

        # 浏览器 PUT 时会带 Content-Type header, 必须一起签进去否则 403.
        signed = self._client.pre_signed_url(
            http_method=tos.HttpMethodType.Http_Method_Put,
            bucket=self._bucket,
            key=object_key,
            expires=expires_in,
            header={"Content-Type": content_type or "application/octet-stream"},
        )
        return PresignResult(
            put_url=signed.signed_url,
            # Viking add_doc(add_type='tos') 认的是 "bucket/key" 形式, 不能带 tos:// 前缀.
            tos_path=f"{self._bucket}/{object_key}",
            object_key=object_key,
            doc_id=doc_id,
            expires_in=expires_in,
        )


tos_client = TosClient()
