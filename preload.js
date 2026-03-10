const { contextBridge, ipcRenderer } = require('electron');

// 安全地暴露API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 获取应用信息
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // 发送消息到主进程
  sendMessage: (channel, data) => {
    const validChannels = ['message-to-main'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // 接收主进程消息
  onMessage: (callback) => {
    ipcRenderer.on('message-from-main', (event, ...args) => callback(...args));
  }
});

// 终端 API
contextBridge.exposeInMainWorld('terminalAPI', {
  // 创建终端
  create: () => ipcRenderer.invoke('terminal-create'),

  // 发送输入到终端
  sendInput: (data) => ipcRenderer.send('terminal-input', data),

  // 接收终端输出
  onOutput: (callback) => {
    ipcRenderer.on('terminal-output', (event, data) => callback(data));
  },

  // 终端退出事件
  onExit: (callback) => {
    ipcRenderer.on('terminal-exit', (event, code) => callback(code));
  },

  // 调整终端大小
  resize: (cols, rows) => ipcRenderer.send('terminal-resize', { cols, rows }),

  // 销毁终端
  destroy: () => ipcRenderer.invoke('terminal-destroy'),

  // 移除监听器
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('terminal-output');
    ipcRenderer.removeAllListeners('terminal-exit');
  }
});

// 对话 API
contextBridge.exposeInMainWorld('chatAPI', {
  // 检查认证状态
  checkAuth: () => ipcRenderer.invoke('check-auth'),

  // 发送消息（流式）
  sendMessage: (message, callbacks, options = {}) => {
    // 先移除旧的监听器
    ipcRenderer.removeAllListeners('chat-chunk');
    ipcRenderer.removeAllListeners('chat-done');
    ipcRenderer.removeAllListeners('chat-error');

    // 注册新的监听器
    ipcRenderer.on('chat-chunk', (event, text) => {
      if (callbacks.onChunk) callbacks.onChunk(text);
    });

    ipcRenderer.on('chat-done', (event, data) => {
      if (callbacks.onDone) callbacks.onDone(data);
    });

    ipcRenderer.on('chat-error', (event, err) => {
      if (callbacks.onError) callbacks.onError(err);
    });

    // 发送消息
    ipcRenderer.send('chat-send', {
      message,
      model: options.model || 'sonnet',
      sessionId: options.sessionId,
      mode: options.mode || 'code',
      workingDir: options.workingDir,
      attachments: options.attachments || []
    });
  },

  // 停止当前对话
  stop: () => ipcRenderer.send('chat-stop'),

  // 移除监听器
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('chat-chunk');
    ipcRenderer.removeAllListeners('chat-done');
    ipcRenderer.removeAllListeners('chat-error');
  }
});

// 会话 API
contextBridge.exposeInMainWorld('sessionAPI', {
  create: (title, mode, model) => ipcRenderer.invoke('session-create', { title, mode, model }),
  update: (id, data) => ipcRenderer.invoke('session-update', { id, data }),
  get: (id) => ipcRenderer.invoke('session-get', id),
  list: () => ipcRenderer.invoke('session-list'),
  archive: (id) => ipcRenderer.invoke('session-archive', id),
  delete: (id) => ipcRenderer.invoke('session-delete', id),
  search: (query) => ipcRenderer.invoke('session-search', query)
});

// 消息 API
contextBridge.exposeInMainWorld('messageAPI', {
  add: (sessionId, role, content, tokens) => ipcRenderer.invoke('message-add', { sessionId, role, content, tokens }),
  list: (sessionId) => ipcRenderer.invoke('message-list', sessionId)
});

// 设置 API
contextBridge.exposeInMainWorld('settingsAPI', {
  get: (key, defaultValue) => ipcRenderer.invoke('settings-get', key, defaultValue),
  set: (key, value) => ipcRenderer.invoke('settings-set', { key, value })
});

// 用量统计 API
contextBridge.exposeInMainWorld('usageAPI', {
  today: () => ipcRenderer.invoke('usage-today'),
  total: () => ipcRenderer.invoke('usage-total'),
  range: (startDate, endDate) => ipcRenderer.invoke('usage-range', { startDate, endDate })
});

// 导入 API
contextBridge.exposeInMainWorld('importAPI', {
  importCliHistory: () => ipcRenderer.invoke('import-cli-history'),
  scanCliHistory: () => ipcRenderer.invoke('scan-cli-history')
});

// Bridge API (飞书等 IM 平台)
contextBridge.exposeInMainWorld('bridgeAPI', {
  // 获取配置
  getConfig: () => ipcRenderer.invoke('bridge-get-config'),

  // 保存配置
  saveConfig: (config) => ipcRenderer.invoke('bridge-save-config', config),

  // 启动 Bridge
  start: (platform) => ipcRenderer.invoke('bridge-start', { platform }),

  // 停止 Bridge
  stop: (platform) => ipcRenderer.invoke('bridge-stop', { platform }),

  // 获取状态
  getStatus: (platform) => ipcRenderer.invoke('bridge-status', { platform }),

  // 监听日志
  onLog: (callback) => {
    ipcRenderer.on('bridge-log', (event, data) => callback(data));
  },

  // 监听状态变化
  onStatusChange: (callback) => {
    ipcRenderer.on('bridge-status', (event, data) => callback(data));
  },

  // 移除监听器
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('bridge-log');
    ipcRenderer.removeAllListeners('bridge-status');
  }
});

// 工作目录 API
contextBridge.exposeInMainWorld('workingDirAPI', {
  select: () => ipcRenderer.invoke('select-working-dir'),
  get: () => ipcRenderer.invoke('get-working-dir'),
  set: (path) => ipcRenderer.invoke('set-working-dir', path)
});

// 文件浏览器 API
contextBridge.exposeInMainWorld('fileAPI', {
  readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  getFileInfo: (path) => ipcRenderer.invoke('get-file-info', path)
});

// 附件 API
contextBridge.exposeInMainWorld('attachmentAPI', {
  select: () => ipcRenderer.invoke('select-attachment')
});

// Workspace API
contextBridge.exposeInMainWorld('workspaceAPI', {
  init: (path) => ipcRenderer.invoke('workspace-init', path),
  read: (path) => ipcRenderer.invoke('workspace-read', path),
  save: (workspacePath, filename, content) => ipcRenderer.invoke('workspace-save', { workspacePath, filename, content })
});

// 检查点 API
contextBridge.exposeInMainWorld('checkpointAPI', {
  create: (sessionId, name) => ipcRenderer.invoke('checkpoint-create', { sessionId, name }),
  list: (sessionId) => ipcRenderer.invoke('checkpoint-list', sessionId),
  rollback: (sessionId, checkpointId) => ipcRenderer.invoke('checkpoint-rollback', { sessionId, checkpointId })
});