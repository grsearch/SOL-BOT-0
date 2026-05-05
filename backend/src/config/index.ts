import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // API keys
  BIRDEYE_API_KEY: z.string().min(1, 'BIRDEYE_API_KEY 必填'),
  HELIUS_API_KEY: z.string().min(1, 'HELIUS_API_KEY 必填'),
  JUPITER_API_KEY: z.string().optional().default(''),
  X_BEARER_TOKEN: z.string().optional().default(''),

  // Discord
  DISCORD_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),

  // Webhook 鉴权
  WEBHOOK_SECRET: z.string().min(8, 'WEBHOOK_SECRET 至少 8 位'),
  // 前端 API 鉴权 token（可选 - 留空时仅 localhost 访问会被允许）
  API_TOKEN: z.string().optional().default(''),

  // 钱包
  WALLET_PASSWORD: z.string().optional().default(''),

  // 服务
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // DB
  DATABASE_PATH: z.string().default('./data.db'),

  // 策略
  DEFAULT_BUY_SOL: z.coerce.number().positive().default(1),
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().positive().default(300),
  DEFAULT_PRIORITY_FEE_LAMPORTS: z.coerce.number().int().nonnegative().default(1_000_000),
  JITO_TIP_LAMPORTS: z.coerce.number().int().nonnegative().default(100_000),

  // 报警/止盈
  STOP_LOSS_DROP_PCT: z.coerce.number().positive().default(50),
  STOP_LOSS_COOLDOWN_HOURS: z.coerce.number().positive().default(2),
  TAKE_PROFIT_GAIN_PCT: z.coerce.number().positive().default(100),

  // 监控
  FDV_MIN_USD: z.coerce.number().nonnegative().default(30_000),
  LP_MIN_USD: z.coerce.number().nonnegative().default(10_000),
  MONITOR_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),

  // X
  X_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(10),
  X_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
  X_FALLBACK_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  X_COST_PER_READ_USD: z.coerce.number().nonnegative().default(0.005),

  // RPC
  SOLANA_RPC_URL: z.string().url().optional(),
  SOLANA_WS_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ 环境变量校验失败:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

// RPC 默认值（如果用户没显式设置，就用 Helius）
const rpcUrl = env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
const wsUrl = env.SOLANA_WS_URL || `wss://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;

export const config = {
  ...env,
  SOLANA_RPC_URL: rpcUrl,
  SOLANA_WS_URL: wsUrl,
} as const;

export type Config = typeof config;
