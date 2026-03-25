#!/bin/bash

# 启动应用脚本

# 停止可能运行的服务器
if [ -f "./server.cjs" ]; then
  echo "停止之前的服务器..."
  pkill -f "node server.cjs" 2>/dev/null
  pkill -f "npm run dev" 2>/dev/null
  sleep 1
fi

# 确保 5174 端口可用
echo "检查端口 5174..."
PORT_PID=$(lsof -ti:5174 2>/dev/null)
if [ ! -z "$PORT_PID" ]; then
  echo "发现进程占用端口 5174，PID: $PORT_PID"
  kill -9 $PORT_PID 2>/dev/null
  sleep 1
  echo "已清理端口 5174"
fi

# 启动服务器
echo "启动服务器..."
node server.cjs &
sleep 2

# 启动开发服务器
echo "启动开发服务器..."
npm run dev &
sleep 3

# 打开浏览器
echo "打开应用..."
open http://localhost:5174/
