#!/bin/bash

cd "$(dirname "$0")"

echo "=========================================="
echo "ClaudePilot 桌面应用启动脚本"
echo "=========================================="

# 检查Node.js
if ! command -v node &> /dev/null; then
  echo "错误: Node.js未安装，请先安装Node.js 18或更高版本"
  exit 1
fi

# 检查依赖
if [ ! -d "node_modules/electron" ]; then
  echo "检测到依赖未安装，开始安装..."
  echo "建议先运行 ./install.sh 使用国内镜像加速安装"
  echo "或者按回车键继续使用npm安装（可能较慢）"
  read -p "是否继续？[Y/n] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]] || [ -z "$REPLY" ]; then
    echo "安装依赖..."
    npm install --no-optional
  else
    echo "请先运行 ./install.sh 安装依赖"
    exit 1
  fi
fi

# 检查electron二进制文件
if [ ! -f "node_modules/.bin/electron" ]; then
  echo "警告: electron二进制文件未找到，尝试修复..."
  npm rebuild
fi

echo "启动应用..."
echo "如果应用没有启动，请检查网络连接"
echo "首次运行需要下载Electron二进制文件（约100MB）"
echo "请耐心等待..."
echo ""

# 设置electron镜像环境变量
export ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"

# 启动应用
npx electron .