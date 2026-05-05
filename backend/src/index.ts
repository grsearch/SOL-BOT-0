import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { migrate } from './db/migrate.js';
import { wallet } from './wallet/index.js';
import { keystoreExists } from './wallet/keystore.js';
import { registerRoutes } from './api/routes.js';
import { registerWsBridge } from './api/wsBridge.js';
import { strategyEngine } from './strategies/engine.js';
import path from 'path';
import { sendInfo } from './services/discord/client.js';

const KEYSTORE_PATH = path.resolve(process.cwd(), 'wallet.keystore.json');

async function readPasswordHidden(): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write('请输入钱包解锁密码: ');
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    let buf = '';
    const onData = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(buf);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f') {
        if (buf.length > 0) buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function unlockWallet(): Promise<void> {
  if (!keystoreExists(KEYSTORE_PATH)) {
    console.error(`❌ 找不到 ${KEYSTORE_PATH}，请先运行 npm run wallet:create 或 wallet:import`);
    process.exit(1);
  }
  let password = config.WALLET_PASSWORD;
  if (!password) {
    password = await readPasswordHidden();
  }
  await wallet.unlock(password);
}

async function bootstrap(): Promise<void> {
  // 1. DB
  migrate();

  // 2. 钱包
  await unlockWallet();

  // 3. HTTP server
  const app = Fastify({ logger: false, trustProxy: true });
  // ★ 安全修：CORS 只允许 FRONTEND_URL，不再反射任意 origin（防 CSRF）
  // 如果你部署到不同 host，把那个 host 加进 origins 数组里
  const allowedOrigins = [config.FRONTEND_URL];
  await app.register(cors, {
    origin: (origin, cb) => {
      // 允许同源（无 origin 头，比如 curl 或 SSR）
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin 未授权'), false);
    },
    credentials: true,
  });
  await app.register(websocket);
  await registerRoutes(app);
  registerWsBridge(app);

  app.setErrorHandler((err: any, req, reply) => {
    logger.error({ err: err?.message ?? String(err), url: req.url }, 'HTTP 错误');
    reply.code(err?.statusCode ?? 500).send({ error: err?.message ?? 'internal_error' });
  });

  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ port: config.PORT }, `HTTP/WS 监听在 ${config.HOST}:${config.PORT}`);

  // 4. 策略引擎
  strategyEngine.start();

  // 5. 启动通知
  await sendInfo('🤖 Trading Bot 已启动', `钱包: \`${wallet.address}\`\n监听端口: ${config.PORT}`);

  // 优雅关闭
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '准备关闭');
    strategyEngine.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((e) => {
  logger.error({ err: e.message, stack: e.stack }, '启动失败');
  process.exit(1);
});
