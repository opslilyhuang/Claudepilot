/**
 * ClaudePilot 数据库模块
 * 使用 SQLite 存储会话、消息、设置等
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// 生成 UUID
function uuidv4() {
  return crypto.randomUUID();
}

// 数据目录
const DATA_DIR = path.join(os.homedir(), '.claudepilot');
const DB_PATH = path.join(DATA_DIR, 'claudepilot.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

// 创建数据库连接
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 初始化表结构
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT DEFAULT 'code',
    model TEXT DEFAULT 'sonnet',
    working_dir TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 设置表
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 工作区配置表
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT,
    soul_md TEXT,
    user_md TEXT,
    claude_md TEXT,
    memory_md TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Token 用量统计表
  CREATE TABLE IF NOT EXISTS usage_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    UNIQUE(date, model)
  );

  -- 检查点表
  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT,
    message_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 索引
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_stats(date);
  CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
`);

// ==================== 会话操作 ====================

const createSession = db.prepare(`
  INSERT INTO sessions (id, title, mode, model, working_dir, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updateSession = db.prepare(`
  UPDATE sessions SET title = ?, mode = ?, model = ?, updated_at = ?, total_tokens = ?, total_cost = ?
  WHERE id = ?
`);

const getSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

const getAllSessions = db.prepare(`
  SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC
`);

const getArchivedSessions = db.prepare(`
  SELECT * FROM sessions WHERE archived = 1 ORDER BY updated_at DESC
`);

const archiveSession = db.prepare(`UPDATE sessions SET archived = 1 WHERE id = ?`);

const deleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);

const searchSessions = db.prepare(`
  SELECT s.* FROM sessions s
  LEFT JOIN messages m ON s.id = m.session_id
  WHERE s.archived = 0 AND (s.title LIKE ? OR m.content LIKE ?)
  GROUP BY s.id
  ORDER BY s.updated_at DESC
`);

// ==================== 消息操作 ====================

const addMessage = db.prepare(`
  INSERT INTO messages (id, session_id, role, content, tokens, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getMessages = db.prepare(`
  SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC
`);

const deleteMessages = db.prepare(`DELETE FROM messages WHERE session_id = ?`);

// ==================== 检查点操作 ====================

const createCheckpoint = db.prepare(`
  INSERT INTO checkpoints (id, session_id, name, message_count, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const getCheckpoints = db.prepare(`
  SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC
`);

const deleteCheckpoint = db.prepare(`DELETE FROM checkpoints WHERE id = ?`);

const deleteMessagesAfter = db.prepare(`
  DELETE FROM messages WHERE session_id = ? AND created_at > (
    SELECT created_at FROM messages WHERE session_id = ?
    ORDER BY created_at ASC LIMIT 1 OFFSET ?
  )
`);

// ==================== 设置操作 ====================

const getSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const setSetting = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);

// ==================== 用量统计 ====================

const addUsage = db.prepare(`
  INSERT INTO usage_stats (date, model, input_tokens, output_tokens, cost)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(date, model) DO UPDATE SET
    input_tokens = input_tokens + excluded.input_tokens,
    output_tokens = output_tokens + excluded.output_tokens,
    cost = cost + excluded.cost
`);

const getUsageByDate = db.prepare(`
  SELECT * FROM usage_stats WHERE date = ?
`);

const getUsageRange = db.prepare(`
  SELECT date, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cost) as cost
  FROM usage_stats
  WHERE date BETWEEN ? AND ?
  GROUP BY date
  ORDER BY date
`);

const getTotalUsage = db.prepare(`
  SELECT SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cost) as cost
  FROM usage_stats
`);

// ==================== 导出函数 ====================

module.exports = {
  // 会话
  createSession: (title, mode = 'code', model = 'sonnet', workingDir = null) => {
    const id = uuidv4();
    const now = Date.now();
    createSession.run(id, title, mode, model, workingDir, now, now);
    return { id, title, mode, model, working_dir: workingDir, created_at: now, updated_at: now };
  },

  updateSession: (id, data) => {
    const session = getSession.get(id);
    if (!session) return null;
    updateSession.run(
      data.title ?? session.title,
      data.mode ?? session.mode,
      data.model ?? session.model,
      Date.now(),
      data.total_tokens ?? session.total_tokens,
      data.total_cost ?? session.total_cost,
      id
    );
    return getSession.get(id);
  },

  getSession: (id) => getSession.get(id),

  getAllSessions: () => getAllSessions.all(),

  getArchivedSessions: () => getArchivedSessions.all(),

  archiveSession: (id) => archiveSession.run(id),

  deleteSession: (id) => {
    deleteMessages.run(id);
    deleteSession.run(id);
  },

  searchSessions: (query) => {
    const pattern = `%${query}%`;
    return searchSessions.all(pattern, pattern);
  },

  // 消息
  addMessage: (sessionId, role, content, tokens = 0) => {
    const id = uuidv4();
    const now = Date.now();
    addMessage.run(id, sessionId, role, content, tokens, now);

    // 更新会话的 updated_at
    const session = getSession.get(sessionId);
    if (session) {
      updateSession.run(
        session.title,
        session.mode,
        session.model,
        now,
        session.total_tokens + tokens,
        session.total_cost,
        sessionId
      );
    }

    return { id, session_id: sessionId, role, content, tokens, created_at: now };
  },

  getMessages: (sessionId) => getMessages.all(sessionId),

  // 设置
  getSetting: (key, defaultValue = null) => {
    const row = getSetting.get(key);
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  },

  setSetting: (key, value) => {
    setSetting.run(key, typeof value === 'string' ? value : JSON.stringify(value));
  },

  // 用量统计
  addUsage: (model, inputTokens, outputTokens, cost = 0) => {
    const date = new Date().toISOString().split('T')[0];
    addUsage.run(date, model, inputTokens, outputTokens, cost);
  },

  getUsageToday: () => {
    const date = new Date().toISOString().split('T')[0];
    return getUsageByDate.all(date);
  },

  getUsageRange: (startDate, endDate) => getUsageRange.all(startDate, endDate),

  getTotalUsage: () => getTotalUsage.get(),

  // 导入 Claude CLI 历史
  importCliHistory: (jsonlPath) => {
    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.trim().split('\n');

    const sessionTitle = path.basename(jsonlPath, '.jsonl');
    const session = module.exports.createSession(sessionTitle, 'code', 'sonnet');

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' || entry.type === 'assistant') {
          module.exports.addMessage(
            session.id,
            entry.type === 'user' ? 'user' : 'assistant',
            entry.message || entry.content || ''
          );
        }
      } catch (e) {
        console.error('Failed to parse line:', e);
      }
    }

    return session;
  },

  // 检查点
  createCheckpoint: (sessionId, name) => {
    const id = uuidv4();
    const now = Date.now();
    const messages = getMessages.all(sessionId);
    const messageCount = messages.length;
    createCheckpoint.run(id, sessionId, name || `Checkpoint ${messageCount}`, messageCount, now);
    return { id, session_id: sessionId, name, message_count: messageCount, created_at: now };
  },

  getCheckpoints: (sessionId) => getCheckpoints.all(sessionId),

  rollbackToCheckpoint: (sessionId, checkpointId) => {
    const checkpoints = getCheckpoints.all(sessionId);
    const checkpoint = checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return { success: false, error: 'Checkpoint not found' };

    // 删除检查点之后的消息
    const messages = getMessages.all(sessionId);
    if (messages.length > checkpoint.message_count) {
      // 获取要保留的消息 ID
      const keepIds = messages.slice(0, checkpoint.message_count).map(m => m.id);
      db.prepare(`DELETE FROM messages WHERE session_id = ? AND id NOT IN (${keepIds.map(() => '?').join(',')})`).run(sessionId, ...keepIds);
    }

    // 删除此检查点之后创建的检查点
    db.prepare(`DELETE FROM checkpoints WHERE session_id = ? AND created_at > ?`).run(sessionId, checkpoint.created_at);

    return { success: true, message_count: checkpoint.message_count };
  },

  // 关闭数据库
  close: () => db.close()
};
