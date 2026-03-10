/**
 * 飞书 Bridge - 使用官方 SDK 长连接
 *
 * 连接飞书机器人和 Claude CLI
 */

const lark = require('@larksuiteoapi/node-sdk');
const { spawn } = require('child_process');

// 配置
const APP_ID = process.env.CTI_FEISHU_APP_ID;
const APP_SECRET = process.env.CTI_FEISHU_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  console.error('Missing CTI_FEISHU_APP_ID or CTI_FEISHU_APP_SECRET');
  process.exit(1);
}

console.log('Starting Feishu Bridge...');
console.log(`App ID: ${APP_ID.substring(0, 8)}...`);

// 创建飞书客户端
const client = new lark.Client({
  appId: APP_ID,
  appSecret: APP_SECRET,
  disableTokenCache: false
});

// 调用 Claude CLI 处理消息
function processWithClaude(message) {
  return new Promise((resolve, reject) => {
    let response = '';
    let errorOutput = '';

    const claude = spawn('claude', ['-p'], {
      shell: false,
      env: process.env
    });

    claude.stdout.on('data', (data) => {
      response += data.toString();
    });

    claude.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // 通过 stdin 发送消息
    claude.stdin.write(message);
    claude.stdin.end();

    claude.on('close', (code) => {
      if (code === 0 && response) {
        resolve(response.trim());
      } else {
        reject(new Error(errorOutput || `Claude exited with code ${code}`));
      }
    });

    claude.on('error', reject);

    // 超时处理 (5分钟)
    setTimeout(() => {
      claude.kill();
      reject(new Error('Claude timeout'));
    }, 300000);
  });
}

// 发送消息到飞书
async function sendMessage(chatId, content) {
  try {
    await client.im.message.create({
      params: {
        receive_id_type: 'chat_id'
      },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content })
      }
    });
    console.log('Message sent to', chatId);
  } catch (error) {
    console.error('Failed to send message:', error.message);
  }
}

// 处理收到的消息
async function handleMessage(event) {
  try {
    const message = event.message;
    if (!message) return;

    // 只处理文本消息
    if (message.message_type !== 'text') {
      console.log('Ignoring non-text message');
      return;
    }

    const content = JSON.parse(message.content);
    const text = content.text;
    const chatId = message.chat_id;

    console.log(`Received message: ${text}`);

    // 发送 "正在思考" 提示
    await sendMessage(chatId, '🤔 正在思考...');

    // 调用 Claude 处理
    const response = await processWithClaude(text);

    // 发送响应
    await sendMessage(chatId, response);
    console.log('Response sent');

  } catch (error) {
    console.error('Error handling message:', error);

    // 尝试发送错误消息
    try {
      const chatId = event.message?.chat_id;
      if (chatId) {
        await sendMessage(chatId, `❌ 处理消息时出错: ${error.message}`);
      }
    } catch (e) {
      console.error('Failed to send error message:', e);
    }
  }
}

// 创建事件分发器
const eventDispatcher = new lark.EventDispatcher({
  encryptKey: '', // 如果设置了加密密钥，填入这里
  verificationToken: '' // 如果设置了验证 token，填入这里
}).register({
  'im.message.receive_v1': async (data) => {
    console.log('Received im.message.receive_v1 event');
    await handleMessage(data);
  }
});

// 使用长连接模式
async function startWithWebSocket() {
  try {
    // 飞书 SDK 的 WebSocket 客户端
    const wsClient = new lark.WSClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      loggerLevel: lark.LoggerLevel.INFO
    });

    // start 方法需要传入 eventDispatcher
    await wsClient.start({
      eventDispatcher
    });
    console.log('Feishu Bridge started - WebSocket connected!');
    console.log('Waiting for messages...');

  } catch (error) {
    console.error('Failed to start WebSocket:', error);
    throw error;
  }
}

// 主函数
async function main() {
  try {
    await startWithWebSocket();
  } catch (error) {
    console.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

main();
