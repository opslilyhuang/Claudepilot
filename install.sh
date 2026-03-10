#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=========================================="
echo "ClaudePilot 桌面应用安装脚本"
echo "=========================================="

# 检查Node.js版本
echo "检查Node.js版本..."
node_version=$(node --version | cut -d'v' -f2)
major_version=$(echo $node_version | cut -d'.' -f1)
if [ $major_version -lt 18 ]; then
  echo "错误: 需要Node.js 18或更高版本，当前版本: $node_version"
  exit 1
fi
echo "✓ Node.js $node_version 符合要求"

# 设置npm淘宝镜像
echo "设置npm淘宝镜像加速..."
npm config set registry https://registry.npmmirror.com/
npm config set electron_mirror "https://cdn.npmmirror.com/binaries/electron/"
npm config set electron_builder_binaries_mirror "https://npmmirror.com/mirrors/electron-builder-binaries/"

# 设置环境变量
export ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"
export ELECTRON_CUSTOM_DIR="v{{ version }}"

echo "开始安装依赖..."
echo "这可能需要几分钟时间，取决于您的网络速度..."

# 安装依赖（不安装可选依赖，减少失败概率）
npm install --no-optional --verbose

# 检查安装是否成功
if [ -f "node_modules/.bin/electron" ]; then
  echo "✓ 依赖安装成功!"
  echo ""
  echo "启动应用: npm start 或 ./start.sh"
  echo "应用将在启动后自动下载Electron二进制文件"
else
  echo "⚠ 依赖安装可能不完整，请尝试以下方法："
  echo "1. 手动运行: npm install --verbose"
  echo "2. 或使用cnpm: npm install -g cnpm && cnpm install"
  echo "3. 检查网络连接，确保可以访问 https://cdn.npmmirror.com"
fi

echo ""
echo "安装完成！"