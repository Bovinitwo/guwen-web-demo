#!/usr/bin/env bash
# 一键装环境: 后端 venv + 依赖, 前端 npm 依赖, 若 backend/.env 缺失生成占位模板.
# 跑完再执行 ./start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------- 1. Python ----------
echo "==> [1/4] 检查 Python"
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "[error] 找不到 python3."
  echo "CentOS/RHEL 装 3.9:  sudo yum install -y python39 python39-devel"
  echo "Ubuntu/Debian:       sudo apt install -y python3 python3-venv"
  echo "然后重跑本脚本, 或用 PYTHON=python3.9 ./init.sh"
  exit 1
fi

PYVER=$("$PYTHON" -c 'import sys;print("%d.%d"%sys.version_info[:2])')
PYMAJOR=$("$PYTHON" -c 'import sys;print(sys.version_info[0])')
PYMINOR=$("$PYTHON" -c 'import sys;print(sys.version_info[1])')
if [[ "$PYMAJOR" -lt 3 || ( "$PYMAJOR" -eq 3 && "$PYMINOR" -lt 8 ) ]]; then
  echo "[error] Python $PYVER 太老, 需要 >= 3.8"
  echo "CentOS 7 装 3.9:  sudo yum install -y python39 && PYTHON=python3.9 ./init.sh"
  exit 1
fi
echo "    Python $PYVER 位于 $(command -v "$PYTHON")"

# ---------- 2. backend venv + 依赖 ----------
echo "==> [2/4] 建 backend/.venv + 装 pip 依赖"
if [[ ! -d backend/.venv ]]; then
  "$PYTHON" -m venv backend/.venv
fi
# CentOS/Ubuntu 上 pip 版本可能很老, 升一下再装
backend/.venv/bin/pip install --quiet --upgrade pip
backend/.venv/bin/pip install --quiet -r backend/requirements.txt
echo "    venv OK: $(backend/.venv/bin/python --version)"

# ---------- 3. Node ----------
echo "==> [3/4] 检查 Node + 装前端依赖"
if ! command -v node >/dev/null 2>&1; then
  echo "[error] 找不到 node."
  echo "CentOS/RHEL 装 20:   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -"
  echo "                     sudo yum install -y nodejs"
  echo "Ubuntu/Debian:       curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
  echo "                     sudo apt install -y nodejs"
  exit 1
fi
NODEMAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [[ "$NODEMAJOR" -lt 18 ]]; then
  echo "[error] Node $(node -v) 太老, Vite 5 需要 >= 18"
  exit 1
fi
echo "    Node $(node -v), npm $(npm -v)"
(cd frontend && npm install --no-fund --no-audit)

# ---------- 4. backend/.env 模板 ----------
echo "==> [4/4] 检查 backend/.env"
if [[ -f backend/.env ]]; then
  echo "    backend/.env 已存在, 跳过"
else
  cat > backend/.env <<'EOF'
# 火山方舟 对话模型 (OpenAI 兼容)
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL_ENDPOINT=doubao-seed-evolving-latest-version

# 火山 Viking 知识库 (独立 API Key)
ARK_KB_BASE_URL=https://api-knowledgebase.mlp.cn-beijing.volces.com
# 注意: 填知识库的名字, 不是 kb-xxx 那个 ID
ARK_KB_COLLECTION_NAME=
ARK_KB_RESOURCE_ID=
ARK_KB_PROJECT=default
VIKING_API_KEY=

# 火山 TOS 对象存储 (给浏览器 presign 直传)
TOS_ENDPOINT=tos-cn-beijing.volces.com
TOS_REGION=cn-beijing
TOS_BUCKET=
TOS_ACCESS_KEY_ID=
TOS_SECRET_ACCESS_KEY=

PORT=8000
EOF
  echo "    已生成 backend/.env 模板, 编辑填 key 后再 ./start.sh"
fi

echo ""
echo "环境就绪. 下一步:"
echo "  1) 编辑 backend/.env, 填 ARK/VIKING/TOS 相关的 key"
echo "  2) ./start.sh"
