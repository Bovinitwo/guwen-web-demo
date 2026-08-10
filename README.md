# 知识助手

最小可运行的「上传文档 → 基于文档问答」demo，Codex 风格的清爽界面。

- 后端：FastAPI，转发到 火山方舟 对话（OpenAI 兼容）和 火山方舟 知识库。
- 前端：Vite + React + TypeScript，SSE 流式接收回答。

## 架构

```
用户
  │
  ▼
[Frontend  React]
  │  /api/upload   → 上传文件
  │  /api/chat     → SSE 问答
  ▼
[Backend  FastAPI]
  │  ┌── POST 知识库 doc/add （上传）
  │  ├── POST 知识库 search_knowledge （检索）
  │  └── POST 方舟 chat/completions stream=true （生成）
  ▼
[火山方舟 Pod + 知识库]
```

## 快速启动

### 1. 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env，填 ARK_API_KEY / ARK_MODEL_ENDPOINT / ARK_KB_COLLECTION_NAME
uvicorn main:app --reload --port 8000
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
# 打开 http://localhost:5173
```

Vite dev server 已配置把 `/api/*` 代理到 `http://localhost:8000`，无需再改 CORS。

## 环境变量

见 `backend/.env.example`：

| 变量 | 说明 |
| --- | --- |
| `ARK_API_KEY` | 方舟 API Key |
| `ARK_BASE_URL` | 方舟对话 base url（默认北京 v3） |
| `ARK_MODEL_ENDPOINT` | 方舟对话 endpoint id（`ep-xxx`） |
| `ARK_KB_BASE_URL` | 方舟知识库 base url |
| `ARK_KB_COLLECTION_NAME` | 知识库 collection 名 |
| `ARK_KB_PROJECT` | 项目名，默认 `default` |

## 待确认 / TODO

1. **知识库 REST 路径**：`ark_client.py` 里 `/api/knowledge/doc/add`、`/doc/list`、`/collection/search_knowledge` 是常见路径；如果你的租户开的知识库路径不同，需要按控制台文档校准。
2. **鉴权头**：目前统一用 `Authorization: Bearer <ARK_API_KEY>`。如果知识库要求 AK/SK 签名或额外 header，需要在 `_kb_client` 里补上。
3. **上传后索引延迟**：Ark 知识库索引不是同步的，前端提示了「索引可能需要一会儿」。如果想做「上传完成再问」的严格体验，需要轮询 doc 状态。
4. **数据库**：申请了但当前 MVP 没用到；后续持久化会话历史再接。

## 目录

```
guwen-web-demo/
├── backend/
│   ├── main.py            # FastAPI 入口 + 路由
│   ├── ark_client.py      # 方舟 对话 & 知识库 封装
│   ├── config.py          # env 读取
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.tsx        # 主界面
    │   ├── api.ts         # SSE 解析 & 上传
    │   ├── main.tsx
    │   └── styles.css
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── index.html
```
