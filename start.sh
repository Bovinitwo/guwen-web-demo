#!/usr/bin/env bash
# 后台起前后端. 日志写到 logs/, PID 写到 logs/*.pid. 已在跑的端口会跳过.
# 默认绑 0.0.0.0 便于云主机公网访问; 只想本机可访问用 HOST=127.0.0.1 ./start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

HOST="${HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

mkdir -p logs

port_busy() { lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# --- backend ---
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
  echo "[start] backend $HOST:$BACKEND_PORT"
  (
    cd backend
    nohup .venv/bin/uvicorn main:app --host "$HOST" --port "$BACKEND_PORT" \
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
  echo "[start] frontend $HOST:$FRONTEND_PORT"
  (
    cd frontend
    nohup npm run dev -- --host "$HOST" --port "$FRONTEND_PORT" \
      > "$ROOT/logs/frontend.log" 2>&1 &
    echo $! > "$ROOT/logs/frontend.pid"
  )
fi

sleep 1

# 给一个"外面能用的地址"提示 (不精确, 只是给用户参考)
EXT_IP=""
if command -v hostname >/dev/null 2>&1; then
  EXT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
DISPLAY_HOST="${EXT_IP:-127.0.0.1}"
[[ "$HOST" == "127.0.0.1" ]] && DISPLAY_HOST="127.0.0.1"

echo ""
echo "  backend   http://$DISPLAY_HOST:$BACKEND_PORT   (tail -f logs/backend.log)"
echo "  frontend  http://$DISPLAY_HOST:$FRONTEND_PORT     (tail -f logs/frontend.log)"
echo ""
if [[ "$HOST" == "0.0.0.0" ]]; then
  echo "已绑 0.0.0.0. 外网访问还需要: (a) 云安全组放行 $BACKEND_PORT/$FRONTEND_PORT; (b) 若开了 firewalld/iptables, 也放行"
fi
echo "停止:  ./stop.sh"
