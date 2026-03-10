# ClaudePilot

<img src="icon.png" width="64" height="64" alt="ClaudePilot" />

**Claude Code 桌面客户端** - AI 编程助手

[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/opslilyhuang/Claudepilot/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

## 功能特性

### 核心功能
- **AI 对话** - 通过 Claude CLI 进行智能对话
- **内置终端** - 支持运行 `claude login` 完成认证
- **会话管理** - 创建、搜索、归档对话会话
- **Token 统计** - 实时显示用量和费用

### 扩展功能
- **工作目录** - 选择项目文件夹作为 Claude 工作目录
- **文件附件** - 在对话中发送文件和图片
- **交互模式** - Code / Plan / Ask 三种模式
- **检查点** - 保存会话状态，支持回退
- **飞书 Bridge** - 通过飞书机器人与 Claude 对话
- **多语言** - 中文 / English 界面切换
- **深色主题** - 支持深色 / 浅色主题切换
- **CLI 导入** - 导入 Claude Code CLI 历史会话

---

## 安装

### 前置要求

1. 安装 Claude Code CLI:
```bash
npm install -g @anthropic-ai/claude-code
```

2. 认证:
```bash
claude login
```

### 下载安装

从 [Releases](https://github.com/opslilyhuang/Claudepilot/releases) 页面下载对应平台的安装包。

### 源码构建

```bash
git clone https://github.com/opslilyhuang/Claudepilot.git
cd Claudepilot
npm install
npm start              # 开发模式
npm run build:mac      # 构建 macOS 版本
```

---

## 使用指南

### 首次使用

1. 启动 ClaudePilot
2. 如果未认证，进入终端页面
3. 输入 `claude login` 完成认证
4. 返回对话页面开始使用

### 选择工作目录

点击侧边栏的文件夹按钮，选择项目目录。Claude 将在该目录下工作，可以读取和修改项目文件。

### 飞书 Bridge

1. 进入 Bridge 页面
2. 填入飞书应用的 App ID 和 App Secret
3. 点击连接
4. 在飞书中与机器人对话

---

## 技术栈

- **Electron** - 桌面应用框架
- **node-pty** - 伪终端支持
- **xterm.js** - 终端 UI
- **better-sqlite3** - 本地数据存储
- **@larksuiteoapi/node-sdk** - 飞书 SDK

---

## 许可证

MIT License
