"""火山 Viking 知识库 SDK 的 Bearer API-Key 适配层。

背景: `volcengine.viking_knowledgebase.VikingKnowledgeBaseService` 的 KB 端点
    目前仍走 AK/SK 的 V4 签名, SDK 层不认 Bearer VIKING_API_KEY。
    但服务端 `search_knowledge` 等端点已经支持 `Authorization: Bearer <VIKING_API_KEY>`.
    这里劫持 `SignerV4.sign` 静态方法, 让它把 Authorization 换成 Bearer,
    同时跳过父类 __init__ 里那个用 AK/SK 打 Ping 的自检.
    等 SDK 官方补上 API-Key 认证后, 这个 shim 可以直接删掉换回原生构造函数.
"""
from __future__ import annotations

from volcengine.auth import SignerV4 as _signer_module
from volcengine.viking_knowledgebase import VikingKnowledgeBaseService
from volcengine.base.Service import Service


_ORIG_SIGN = _signer_module.SignerV4.sign


def _install_bearer_sign(api_key: str) -> None:
    """把 SignerV4.sign 换成注入 Bearer 头的实现."""

    def _bearer_sign(request, credentials):  # noqa: ARG001
        request.headers["Authorization"] = f"Bearer {api_key}"

    _signer_module.SignerV4.sign = staticmethod(_bearer_sign)


def build_kb_service(
    api_key: str,
    host: str = "api-knowledgebase.mlp.cn-beijing.volces.com",
    region: str = "cn-beijing",
) -> VikingKnowledgeBaseService:
    _install_bearer_sign(api_key)

    # 绕开 VikingKnowledgeBaseService.__init__ 里那次 Ping (需要 AKSK 才通过),
    # 直接手动装配 service_info / api_info.
    svc = VikingKnowledgeBaseService.__new__(VikingKnowledgeBaseService)
    svc.service_info = VikingKnowledgeBaseService.get_service_info(
        host, region, "https", 30, 30
    )
    svc.api_info = VikingKnowledgeBaseService.get_api_info()
    Service.__init__(svc, svc.service_info, svc.api_info)
    return svc
