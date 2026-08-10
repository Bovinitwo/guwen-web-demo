#!/usr/bin/env bash
# 后台起服务.
#   默认 MODE=prod: 只起 backend, backend 从 8000 端口同时托管 frontend/dist/ (打包好的静态资源).
#                  访问 http://<host>:8000 一个地址搞定, 加载秒开.
#   MODE=dev:      前后端分别起, backend 8000 + vite 5173, 支持 HMR 但远程访问慢.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MODE="${MODE:-prod}"
HOST="${HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

mkdir -p logs

port_busy() { lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# dist 不存在, 或任意源文件比 dist/index.html 新 -> 需要 rebuild
frontend_needs_build() {
  local dist="$ROOT/frontend/dist/index.html"
  [[ -f "$dist" ]] || return 0
  local newer
  newer=$(find \
    "$ROOT/frontend/src" \
    "$ROOT/frontend/index.html" \
    "$ROOT/frontend/package.json" \
    "$ROOT/frontend/vite.config.ts" \
    "$ROOT/frontend/tsconfig.json" \
    -newer "$dist" -print -quit 2>/dev/null)
  [[ -n "$newer" ]]
}

# ---------- backend ----------
if port_busy "$BACKEND_PORT"; then
  echo "[skip] backend: 端口 $BACKEND_PORT 已被占用"
else
  if [[ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]]; then
    echo "[error] backend/.venv 不存在，先跑 ./init.sh"
    exit 1
  fi
  if [[ ! -f "$ROOT/backend/.env" ]]; then
    echo "[error] backend/.env 不存在，先跑 ./init.sh 再编辑 backend/.env"
    exit 1
  fi
  if [[ "$MODE" == "prod" ]] && frontend_needs_build; then
    if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
      echo "[info] frontend/node_modules 不存在, 先跑 npm install…"
      (cd frontend && npm install)
    fi
    echo "[info] frontend 源码有变化 (或首次), 打包 (npm run build)…"
    (cd frontend && npm run build)
  fi
  echo "[start] backend $HOST:$BACKEND_PORT"
  (
    cd backend
    nohup .venv/bin/uvicorn main:app --host "$HOST" --port "$BACKEND_PORT" \
      > "$ROOT/logs/backend.log" 2>&1 &
    echo $! > "$ROOT/logs/backend.pid"
  )
fi

# ---------- frontend (仅 MODE=dev) ----------
if [[ "$MODE" == "dev" ]]; then
  if port_busy "$FRONTEND_PORT"; then
    echo "[skip] frontend: 端口 $FRONTEND_PORT 已被占用"
  else
    if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
      echo "[info] frontend/node_modules 不存在，先跑 npm install…"
      (cd frontend && npm install)
    fi
    echo "[start] frontend $HOST:$FRONTEND_PORT (vite dev)"
    (
      cd frontend
      nohup npm run dev -- --host "$HOST" --port "$FRONTEND_PORT" \
        > "$ROOT/logs/frontend.log" 2>&1 &
      echo $! > "$ROOT/logs/frontend.pid"
    )
  fi
fi

sleep 1

EXT_IP=""
if command -v hostname >/dev/null 2>&1; then
  EXT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
DISPLAY_HOST="${EXT_IP:-127.0.0.1}"
[[ "$HOST" == "127.0.0.1" ]] && DISPLAY_HOST="127.0.0.1"

echo ""
if [[ "$MODE" == "prod" ]]; then
  echo "  访问   http://$DISPLAY_HOST:$BACKEND_PORT"
  echo "  日志   tail -f logs/backend.log"
else
  echo "  frontend  http://$DISPLAY_HOST:$FRONTEND_PORT   (dev, HMR)"
  echo "  backend   http://$DISPLAY_HOST:$BACKEND_PORT   (API)"
fi
echo ""
if [[ "$HOST" == "0.0.0.0" ]]; then
  echo "已绑 0.0.0.0. 外网访问还需要: (a) 云安全组放行端口; (b) firewalld/iptables 也放行"
fi
echo "停止:  ./stop.sh"
