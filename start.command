#!/bin/bash

# Perler to Perfect 一键启动脚本（macOS 可直接双击）
set -u

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
HOST="127.0.0.1"
PORT="5174"
URL="http://${HOST}:${PORT}/"
SERVER_PID=""

pause_before_exit() {
  if [ -t 0 ]; then
    read -r -p "按回车退出..." _
  fi
}

fail() {
  echo
  echo "启动失败：$1"
  pause_before_exit
  exit 1
}

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1
  else
    echo "请手动打开：$URL"
  fi
}

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cd "$PROJECT_DIR" || fail "无法进入项目目录。"

command -v node >/dev/null 2>&1 || fail "未找到 Node.js，请安装 Node.js 20 或更高版本。"
command -v npm >/dev/null 2>&1 || fail "未找到 npm，请检查 Node.js 安装。"

node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1)' \
  || fail "Node.js 版本过低，需要 20 或更高版本。"

if [ ! -x "$PROJECT_DIR/node_modules/.bin/vite" ]; then
  echo "首次运行，正在安装项目依赖..."
  npm install || fail "依赖安装失败。"
fi

# 已有本项目服务时直接复用，避免重复启动。
if curl -fsS --max-time 2 "$URL" 2>/dev/null | grep -q "Perler to Perfect"; then
  echo "项目已经在运行：$URL"
  open_browser
  trap - EXIT INT TERM
  exit 0
fi

# 5174 被其他程序占用时给出明确提示，避免打开错误页面。
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已被其他程序占用。"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  fail "请关闭占用 $PORT 的程序后重试。"
fi

echo "正在启动 Perler to Perfect..."
npm run dev -- --host "$HOST" --port "$PORT" &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "$URL" 2>/dev/null | grep -q "Perler to Perfect"; then
    echo "项目已启动：$URL"
    open_browser
    echo "关闭此窗口即可停止开发服务器。"
    wait "$SERVER_PID"
    exit $?
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    fail "开发服务器启动失败。"
  fi
  sleep 1
done

fail "等待开发服务器超时，请查看上方日志。"
