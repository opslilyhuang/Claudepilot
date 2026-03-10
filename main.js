const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const pty = require('node-pty');
const { spawn } = require('child_process');
const db = require('./database');

let mainWindow;
let ptyProcess = null;

// Bridge 配置目录
const BRIDGE_CONFIG_DIR = path.join(os.homedir(), '.claudepilot');
const BRIDGE_CONFIG_FILE = path.join(BRIDGE_CONFIG_DIR, 'bridge-config.json');

// 确保配置目录存在
function ensureConfigDir() {
  if (!fs.existsSync(BRIDGE_CONFIG_DIR)) {
    fs.mkdirSync(BRIDGE_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

// 读取 Bridge 配置
function loadBridgeConfig() {
  try {
    if (fs.existsSync(BRIDGE_CONFIG_FILE)) {
      const data = fs.readFileSync(BRIDGE_CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load bridge config:', e);
  }
  return { feishu: { appId: '', appSecret: '', enabled: false } };
}

// 保存 Bridge 配置
function saveBridgeConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(BRIDGE_CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.png'),
    title: 'ClaudePilot - AI助手桌面版'
  });

  // 加载应用界面
  mainWindow.loadFile('index.html');

  // 打开开发者工具（开发时使用）
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC通信处理
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('get-app-info', () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  };
});

// ==================== 终端功能 ====================

// 创建终端
ipcMain.handle('terminal-create', (event) => {
  // 如果已有终端进程，先销毁
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {
      console.error('Failed to kill existing PTY:', e);
    }
    ptyProcess = null;
  }

  const shellPath = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh');

  console.log('Creating PTY with shell:', shellPath);

  try {
    ptyProcess = pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: {
        ...process.env,
        TERM: 'xterm-256color'
      }
    });

    console.log('PTY created with PID:', ptyProcess.pid);

    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-output', data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log('PTY exited with code:', exitCode);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-exit', exitCode);
      }
      ptyProcess = null;
    });

    return { success: true, pid: ptyProcess.pid };
  } catch (error) {
    console.error('Failed to create PTY:', error);
    return { success: false, error: error.message };
  }
});

// 终端输入
ipcMain.on('terminal-input', (event, data) => {
  if (ptyProcess) {
    ptyProcess.write(data);
  } else {
    console.warn('Terminal input received but no PTY process');
  }
});

// 调整终端大小
ipcMain.on('terminal-resize', (event, { cols, rows }) => {
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
});

// 销毁终端
ipcMain.handle('terminal-destroy', () => {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
  return true;
});

// ==================== 对话功能 ====================

// 检查认证状态
ipcMain.handle('check-auth', async () => {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], {
      shell: true,
      env: process.env
    });

    let hasOutput = false;
    proc.stdout.on('data', () => {
      hasOutput = true;
    });

    proc.on('close', (code) => {
      resolve(code === 0 && hasOutput);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // 超时处理
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
});

// 流式对话
let chatProcess = null;

// 模型映射
const MODEL_MAP = {
  'sonnet': 'claude-sonnet-4-20250514',
  'opus': 'claude-opus-4-20250514',
  'haiku': 'claude-haiku-3-20250616'
};

// Token 成本 (每百万 token)
const TOKEN_COSTS = {
  'sonnet': { input: 3, output: 15 },
  'opus': { input: 15, output: 75 },
  'haiku': { input: 0.25, output: 1.25 }
};

ipcMain.on('chat-send', (event, { message, model = 'sonnet', sessionId = null, mode = 'code', workingDir = null, attachments = [] }) => {
  console.log('Chat send received:', { message, model, mode, workingDir });

  // 如果有正在进行的对话，先终止
  if (chatProcess) {
    chatProcess.kill();
    chatProcess = null;
  }

  // 构建 claude 命令
  const args = ['-p'];

  // 根据模式添加参数
  if (mode === 'plan') {
    args.push('--plan');
  } else if (mode === 'ask') {
    args.push('--ask');
  }

  // 处理附件 - 将附件内容添加到消息中
  let fullMessage = message;
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.content) {
        fullMessage += `\n\n--- File: ${att.name} ---\n${att.content}\n--- End of ${att.name} ---`;
      }
    }
  }

  console.log('Spawning claude with args:', args);

  const cwd = workingDir || currentWorkingDir || os.homedir();
  chatProcess = spawn('claude', args, {
    cwd: cwd,
    env: process.env,
    shell: false
  });

  let fullResponse = '';
  let inputTokens = Math.ceil(message.length / 4);

  chatProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('Claude stdout:', text);
    fullResponse += text;
    event.reply('chat-chunk', text);
  });

  chatProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.log('Claude stderr:', text);
    // 忽略某些非错误的 stderr 输出
    if (!text.includes('Thinking') && !text.includes('...')) {
      event.reply('chat-error', text);
    }
  });

  // 通过 stdin 发送消息
  chatProcess.stdin.write(message);
  chatProcess.stdin.end();

  chatProcess.on('close', (code) => {
    console.log('Claude process closed with code:', code);
    console.log('Full response:', fullResponse);

    // 估算输出 token 和成本
    const outputTokens = Math.ceil(fullResponse.length / 4);
    const costs = TOKEN_COSTS[model] || TOKEN_COSTS.sonnet;
    const cost = (inputTokens * costs.input + outputTokens * costs.output) / 1000000;

    // 记录用量
    try {
      db.addUsage(model, inputTokens, outputTokens, cost);
    } catch (e) {
      console.error('Failed to add usage:', e);
    }

    event.reply('chat-done', {
      code,
      inputTokens,
      outputTokens,
      cost
    });
    chatProcess = null;
  });

  chatProcess.on('error', (err) => {
    console.error('Claude process error:', err);
    event.reply('chat-error', err.message);
    chatProcess = null;
  });

  chatProcess.on('error', (err) => {
    event.reply('chat-error', err.message);
    chatProcess = null;
  });
});

// 停止当前对话
ipcMain.on('chat-stop', () => {
  if (chatProcess) {
    chatProcess.kill();
    chatProcess = null;
  }
});

// ==================== 会话管理 ====================

ipcMain.handle('session-create', (event, { title, mode, model }) => {
  return db.createSession(title || 'New Conversation', mode, model);
});

ipcMain.handle('session-update', (event, { id, data }) => {
  return db.updateSession(id, data);
});

ipcMain.handle('session-get', (event, id) => {
  return db.getSession(id);
});

ipcMain.handle('session-list', () => {
  return db.getAllSessions();
});

ipcMain.handle('session-archive', (event, id) => {
  db.archiveSession(id);
  return true;
});

ipcMain.handle('session-delete', (event, id) => {
  db.deleteSession(id);
  return true;
});

ipcMain.handle('session-search', (event, query) => {
  return db.searchSessions(query);
});

// ==================== 消息管理 ====================

ipcMain.handle('message-add', (event, { sessionId, role, content, tokens }) => {
  return db.addMessage(sessionId, role, content, tokens);
});

ipcMain.handle('message-list', (event, sessionId) => {
  return db.getMessages(sessionId);
});

// ==================== 设置管理 ====================

ipcMain.handle('settings-get', (event, key, defaultValue) => {
  return db.getSetting(key, defaultValue);
});

ipcMain.handle('settings-set', (event, { key, value }) => {
  db.setSetting(key, value);
  return true;
});

// ==================== 用量统计 ====================

ipcMain.handle('usage-today', () => {
  return db.getUsageToday();
});

ipcMain.handle('usage-total', () => {
  return db.getTotalUsage();
});

ipcMain.handle('usage-range', (event, { startDate, endDate }) => {
  return db.getUsageRange(startDate, endDate);
});

// ==================== CLI 历史导入 ====================

ipcMain.handle('import-cli-history', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Claude CLI 会话文件',
    defaultPath: path.join(os.homedir(), '.claude'),
    filters: [{ name: 'JSONL Files', extensions: ['jsonl'] }],
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Canceled' };
  }

  const imported = [];
  for (const filePath of result.filePaths) {
    try {
      const session = db.importCliHistory(filePath);
      imported.push(session);
    } catch (e) {
      console.error('Failed to import:', filePath, e);
    }
  }

  return { success: true, sessions: imported };
});

// 扫描可导入的 CLI 历史
ipcMain.handle('scan-cli-history', () => {
  const claudeDir = path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeDir, 'projects');

  const sessions = [];

  // 扫描 projects 目录
  if (fs.existsSync(projectsDir)) {
    const scanDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          scanDir(filePath);
        } else if (file.endsWith('.jsonl')) {
          sessions.push({
            path: filePath,
            name: file.replace('.jsonl', ''),
            size: stat.size,
            modified: stat.mtime
          });
        }
      }
    };
    scanDir(projectsDir);
  }

  return sessions;
});

// ==================== 飞书 Bridge 功能 ====================

let feishuBridgeProcess = null;

// 获取 Bridge 配置
ipcMain.handle('bridge-get-config', () => {
  return loadBridgeConfig();
});

// 保存 Bridge 配置
ipcMain.handle('bridge-save-config', (event, config) => {
  saveBridgeConfig(config);
  return true;
});

// 启动飞书 Bridge
ipcMain.handle('bridge-start', async (event, { platform }) => {
  if (platform !== 'feishu') {
    return { success: false, error: 'Only Feishu is supported' };
  }

  const config = loadBridgeConfig();
  if (!config.feishu?.appId || !config.feishu?.appSecret) {
    return { success: false, error: 'Missing Feishu App ID or App Secret' };
  }

  // 如果已有进程在运行，先停止
  if (feishuBridgeProcess) {
    feishuBridgeProcess.kill();
    feishuBridgeProcess = null;
  }

  return new Promise((resolve) => {
    // 设置环境变量并启动 Bridge
    const env = {
      ...process.env,
      CTI_FEISHU_APP_ID: config.feishu.appId,
      CTI_FEISHU_APP_SECRET: config.feishu.appSecret,
      CTI_FEISHU_ENABLED: 'true',
      CTI_RUNTIME: 'claude'
    };

    // 使用 claude-to-im skill 启动 bridge
    // 如果没有安装 skill，使用内置的简易 bridge
    const bridgeScript = path.join(__dirname, 'bridge', 'feishu-bridge.js');

    if (fs.existsSync(bridgeScript)) {
      feishuBridgeProcess = spawn('node', [bridgeScript], {
        env,
        cwd: os.homedir()
      });
    } else {
      // 尝试使用 npx 运行 claude-to-im
      feishuBridgeProcess = spawn('npx', ['claude-to-im', 'start'], {
        shell: true,
        env,
        cwd: os.homedir()
      });
    }

    let started = false;

    feishuBridgeProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Feishu Bridge]', output);
      mainWindow?.webContents.send('bridge-log', { platform: 'feishu', message: output });

      if (!started && (output.includes('started') || output.includes('connected') || output.includes('listening'))) {
        started = true;
        resolve({ success: true });
      }
    });

    feishuBridgeProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error('[Feishu Bridge Error]', output);
      mainWindow?.webContents.send('bridge-log', { platform: 'feishu', message: output, error: true });
    });

    feishuBridgeProcess.on('close', (code) => {
      console.log('[Feishu Bridge] Process exited with code:', code);
      mainWindow?.webContents.send('bridge-status', { platform: 'feishu', status: 'stopped', code });
      feishuBridgeProcess = null;

      if (!started) {
        resolve({ success: false, error: `Process exited with code ${code}` });
      }
    });

    feishuBridgeProcess.on('error', (err) => {
      console.error('[Feishu Bridge] Process error:', err);
      resolve({ success: false, error: err.message });
    });

    // 超时处理
    setTimeout(() => {
      if (!started) {
        started = true;
        // 假设已启动（某些情况下可能没有明确的 "started" 输出）
        resolve({ success: true, warning: 'Started but no confirmation received' });
      }
    }, 5000);
  });
});

// 停止飞书 Bridge
ipcMain.handle('bridge-stop', (event, { platform }) => {
  if (platform === 'feishu' && feishuBridgeProcess) {
    feishuBridgeProcess.kill();
    feishuBridgeProcess = null;
    return { success: true };
  }
  return { success: false, error: 'Bridge not running' };
});

// 获取 Bridge 状态
ipcMain.handle('bridge-status', (event, { platform }) => {
  if (platform === 'feishu') {
    return {
      running: feishuBridgeProcess !== null,
      pid: feishuBridgeProcess?.pid
    };
  }
  return { running: false };
});

// ==================== 工作目录功能 ====================

let currentWorkingDir = os.homedir();

// 选择工作目录
ipcMain.handle('select-working-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择项目目录',
    defaultPath: currentWorkingDir,
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    currentWorkingDir = result.filePaths[0];
    return { success: true, path: currentWorkingDir };
  }
  return { success: false };
});

// 获取当前工作目录
ipcMain.handle('get-working-dir', () => {
  return currentWorkingDir;
});

// 设置工作目录
ipcMain.handle('set-working-dir', (event, dirPath) => {
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    currentWorkingDir = dirPath;
    return { success: true, path: currentWorkingDir };
  }
  return { success: false, error: 'Invalid directory' };
});

// ==================== 文件浏览器功能 ====================

// 读取目录内容
ipcMain.handle('read-directory', (event, dirPath) => {
  const targetPath = dirPath || currentWorkingDir;
  try {
    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    return items
      .filter(item => !item.name.startsWith('.')) // 隐藏隐藏文件
      .map(item => ({
        name: item.name,
        path: path.join(targetPath, item.name),
        isDirectory: item.isDirectory(),
        isFile: item.isFile()
      }))
      .sort((a, b) => {
        // 目录在前
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch (e) {
    return [];
  }
});

// 读取文件内容
ipcMain.handle('read-file', (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) { // 大于 1MB
      return { success: false, error: 'File too large' };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();
    return {
      success: true,
      content,
      name: path.basename(filePath),
      ext,
      size: stat.size
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 获取文件信息
ipcMain.handle('get-file-info', (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return {
      success: true,
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      modified: stat.mtime,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      ext: path.extname(filePath).toLowerCase()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ==================== 附件功能 ====================

// 选择文件作为附件
ipcMain.handle('select-attachment', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '所有文件', extensions: ['*'] },
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: '代码', extensions: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'go', 'rs'] },
      { name: '文档', extensions: ['md', 'txt', 'json', 'yaml', 'yml'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const attachments = [];
    for (const filePath of result.filePaths) {
      try {
        const stat = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);

        let content = null;
        let base64 = null;

        if (isImage && stat.size < 5 * 1024 * 1024) { // 图片小于 5MB
          base64 = fs.readFileSync(filePath).toString('base64');
        } else if (!isImage && stat.size < 1024 * 1024) { // 文本小于 1MB
          content = fs.readFileSync(filePath, 'utf8');
        }

        attachments.push({
          name: path.basename(filePath),
          path: filePath,
          size: stat.size,
          ext,
          isImage,
          content,
          base64
        });
      } catch (e) {
        console.error('Failed to read attachment:', filePath, e);
      }
    }
    return { success: true, attachments };
  }
  return { success: false };
});

// ==================== Assistant Workspace 功能 ====================

const WORKSPACE_FILES = ['soul.md', 'user.md', 'claude.md', 'memory.md'];

// 初始化 Assistant Workspace
ipcMain.handle('workspace-init', (event, workspacePath) => {
  const targetPath = workspacePath || currentWorkingDir;
  const assistantDir = path.join(targetPath, '.assistant');

  try {
    // 创建 .assistant 目录
    if (!fs.existsSync(assistantDir)) {
      fs.mkdirSync(assistantDir, { recursive: true });
    }

    // 创建默认文件
    const defaults = {
      'soul.md': '# Assistant Persona\n\nYou are a helpful coding assistant.',
      'user.md': '# User Profile\n\n- Name: \n- Preferences: ',
      'claude.md': '# Project Rules\n\n- Follow best practices\n- Write clean code',
      'memory.md': '# Memory\n\n## Notes\n\n'
    };

    for (const [filename, defaultContent] of Object.entries(defaults)) {
      const filePath = path.join(targetPath, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, defaultContent);
      }
    }

    return { success: true, path: targetPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 读取 Workspace 文件
ipcMain.handle('workspace-read', (event, workspacePath) => {
  const targetPath = workspacePath || currentWorkingDir;
  const files = {};

  for (const filename of WORKSPACE_FILES) {
    const filePath = path.join(targetPath, filename);
    try {
      if (fs.existsSync(filePath)) {
        files[filename] = fs.readFileSync(filePath, 'utf8');
      }
    } catch (e) {
      console.error('Failed to read workspace file:', filename, e);
    }
  }

  return files;
});

// 保存 Workspace 文件
ipcMain.handle('workspace-save', (event, { workspacePath, filename, content }) => {
  const targetPath = workspacePath || currentWorkingDir;
  const filePath = path.join(targetPath, filename);

  try {
    fs.writeFileSync(filePath, content);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ==================== 会话检查点功能 ====================

// 创建检查点
ipcMain.handle('checkpoint-create', (event, { sessionId, name }) => {
  return db.createCheckpoint(sessionId, name);
});

// 获取检查点列表
ipcMain.handle('checkpoint-list', (event, sessionId) => {
  return db.getCheckpoints(sessionId);
});

// 回退到检查点
ipcMain.handle('checkpoint-rollback', (event, { sessionId, checkpointId }) => {
  return db.rollbackToCheckpoint(sessionId, checkpointId);
});

// ==================== 交互模式 ====================

// 当前模式存储在会话中，通过 session-update 更新