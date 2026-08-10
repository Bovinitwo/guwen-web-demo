#!/usr/bin/env bash
# 停掉 start.sh 拉起的前后端.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for name in backend frontend; do
  pidfile="$ROOT/logs/$name.pid"
  if [[ -f "$pidfile" ]]; then
    pid=$(cat "$pidfile" 2>/dev/null || true)
    if [[ -n "$pid" ]] && kill "$pid" 2>/dev/null; then
      echo "[stop] $name (pid $pid)"
    fi
    rm -f "$pidfile"
  fi
done

# 兜底: 名字匹配再来一遍 (npm/vite 子进程有时候不跟着父 PID 走)
pkill -f "uvicorn main:app" 2>/dev/null && echo "[stop] uvicorn 残留" || true
pkill -f "vite" 2>/dev/null && echo "[stop] vite 残留" || true

echo "done"
