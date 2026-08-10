#!/usr/bin/env bash
# 后台起前后端. 日志写到 logs/, PID 写到 logs/*.pid. 已在跑的端口会跳过.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

mkdir -p logs

port_busy() { lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# --- backend ---
if port_busy "$BACKEND_PORT"; then
  echo "[skip] backend: 端口 $BACKEND_PORT 已被占用"
else
  if [[ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]]; then
    echo "[error] backend/.venv 不存在，先建 venv 并装依赖:"
    echo "    cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
  fi
  if [[ ! -f "$ROOT/backend/.env" ]]; then
    echo "[error] backend/.env 不存在，先 cp backend/.env.example backend/.env 并填 key"
    exit 1
  fi
  echo "[start] backend :$BACKEND_PORT"
  (
    cd backend
    nohup .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
      > "$ROOT/logs/backend.log" 2>&1 &
    echo $! > "$ROOT/logs/backend.pid"
  )
fi

# --- frontend ---
if port_busy "$FRONTEND_PORT"; then
  echo "[skip] frontend: 端口 $FRONTEND_PORT 已被占用"
else
  if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
    echo "[info] frontend/node_modules 不存在，先跑 npm install…"
    (cd frontend && npm install)
  fi
  echo "[start] frontend :$FRONTEND_PORT"
  (
    cd frontend
    nohup npm run dev -- --port "$FRONTEND_PORT" \
      > "$ROOT/logs/frontend.log" 2>&1 &
    echo $! > "$ROOT/logs/frontend.pid"
  )
fi

sleep 1
echo ""
echo "  backend   http://127.0.0.1:$BACKEND_PORT   (tail -f logs/backend.log)"
echo "  frontend  http://localhost:$FRONTEND_PORT     (tail -f logs/frontend.log)"
echo ""
echo "停止:  ./stop.sh"
