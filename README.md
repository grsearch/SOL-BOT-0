# SOL Trading Bot

Solana 链上自动交易机器人，包含 Dashboard、监控引擎、自动交易策略、Discord 报警。

## ⚠️ 安全须知（务必先读）

1. **永远不要把 `.env`、`wallet.keystore.json`、`data.db` 提交到 Git**。`.gitignore` 已配置好。
2. **机器人钱包只放当次交易需要的资金**。建议单独创建一个新钱包专门用于这个机器人，不要用主钱包。
3. **私钥用 AES-256-GCM 加密存盘**，启动时通过环境变量或交互式输入密码解锁。密码不会写入日志。
4. **Discord webhook URL 也是敏感信息**，不要泄露——任何拿到这个 URL 的人都能往你的频道发消息。
5. 所有交易在签名前会做 `simulateTransaction`，失败的不会上链，避免白付 gas。

## 系统架构

```
┌──────────────┐     WebSocket    ┌──────────────────────────┐
│   React UI   │ ◄────────────────│  Backend (Node + TS)     │
│  (Vite, TW)  │ ─── REST ────────►│                          │
└──────────────┘                   │  ┌────────────────────┐  │
                                   │  │ Strategy Engine    │  │
┌──────────────┐                   │  │ - Price Tracker    │  │
│  Discord     │ ◄── webhook ─────┤  │ - Stop Loss Alert  │  │
│  Webhook     │                   │  │ - Auto Take Profit │  │
└──────────────┘                   │  │ - FDV/LP Filter    │  │
                                   │  └────────────────────┘  │
                                   │  ┌────────────────────┐  │
┌──────────────┐                   │  │ External Services  │  │
│  Birdeye WS  │ ◄────────────────┤  │ - Birdeye          │  │
│  Helius RPC  │ ◄────────────────┤  │ - Helius           │  │
│  Jupiter API │ ◄────────────────┤  │ - Jupiter (Swap)   │  │
│  X API       │ ◄────────────────┤  │ - X (mentions)     │  │
└──────────────┘                   │  └────────────────────┘  │
                                   │  SQLite (better-sqlite3) │
                                   └──────────────────────────┘
```

## 功能清单

- ✅ Dashboard：24h PnL、监控列表、交易记录
- ✅ 监控代币：CA、Symbol、Holders、Age、FDV、LP、24h Volume、24h 涨跌幅、X mentions
- ✅ 涨跌幅基于 24h 最高点 vs 现价
- ✅ 添加监控：Dashboard 手动 / Webhook 推送（POST `/webhook/add-token`）
- ✅ 自动移除：FDV<3w 或 LP<1w 时退出监控（持仓先卖）
- ✅ 手动买卖按钮，默认 1 SOL 买入
- ✅ 自动止盈：买入价 2 倍全仓卖
- ✅ 跌幅报警：24h 高点回落 ≥50%，Discord 推送，2 小时冷却
- ✅ 防夹：Jupiter `dynamicSlippage` (max 300bps) + 高优先级 fee + 可选 Jito MEV protect
- ✅ 滑点默认 3%
- ✅ X mentions：每 15 分钟（预算紧张时降级到每小时），日预算上限保护

## 快速开始

### 1. 准备环境

需要 Node.js ≥ 20 和 pnpm/npm。

```bash
git clone <your-repo>
cd sol-trading-bot
cp .env.example .env
# 编辑 .env 填入所有 API key 和 Discord webhook
```

### 2. 创建并加密钱包

```bash
cd backend
npm install
npm run wallet:create  # 交互式生成新钱包并加密存盘
# 或导入已有私钥
npm run wallet:import
```

这会生成 `backend/wallet.keystore.json`（已加密）。**请离线备份你的助记词/私钥**。

### 3. 启动后端

```bash
cd backend
npm run db:migrate  # 初始化 SQLite
npm run dev         # 开发模式
# 或 npm run build && npm start
```

启动时会要求输入钱包解锁密码（或读取 `WALLET_PASSWORD` 环境变量）。

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev  # http://localhost:5173
```

**首次访问前端时**：浏览器会弹出"需要 API Token"，把 `.env` 中的 `API_TOKEN` 值粘贴进去即可（保存到 localStorage，下次自动带上）。也可以用 URL 参数方式：`http://localhost:5173/?api_token=你的token` 自动写入。

### 5. Docker 一键部署

```bash
docker compose up -d
```

详见 `docker-compose.yml`。Docker 模式下 frontend 容器和 backend 容器之间不是 loopback，**必须**在 `.env` 里设置 `API_TOKEN`，否则前端无法访问 API。

## Webhook 接口

```bash
curl -X POST http://localhost:3001/webhook/add-token \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"network":"solana","address":"BWJ7zJauzatao4FsBnGdVsqdBi3k5NbgSY62noZApump","symbol":"Nana"}'
```

注意 webhook 增加了 `x-webhook-secret` 鉴权头，防止公网被乱调。

## 安全须知（再强调一次）

| 鉴权 | 用途 | 没设会怎样 |
|------|------|-----------|
| `WALLET_PASSWORD` | 解锁加密 keystore | 启动时交互式提示输入 |
| `WEBHOOK_SECRET` | 外部调用 `/webhook/add-token` | 必填（≥8 位）。Webhook 端点会拒绝请求 |
| `API_TOKEN` | 前端调用 `/api/*` 和 `/ws` | 没设的话**只允许 loopback (127.0.0.1)** 访问，远程会 401 |

**强烈建议**：HOST 设为 `127.0.0.1`（仅本机）或者放在 nginx/Cloudflare Tunnel 后面。直接把 PORT 暴露到公网 + 不设 API_TOKEN = 任何人能调你的钱包做交易。

## 重要参数（`.env`）

| 变量 | 说明 |
|------|------|
| `BIRDEYE_API_KEY` | Birdeye Premium Plus key |
| `HELIUS_API_KEY` | Helius Business plan key |
| `JUPITER_API_KEY` | Jupiter Developer plan key |
| `API_TOKEN` | 前端访问 API 的鉴权令牌（推荐设置） |
| `X_BEARER_TOKEN` | X API bearer token（pay-per-use 模式） |
| `DISCORD_WEBHOOK_URL` | Discord 报警 webhook |
| `WEBHOOK_SECRET` | 接收外部 webhook 的鉴权密码 |
| `WALLET_PASSWORD` | 钱包解锁密码（不设则启动时交互式输入） |
| `DEFAULT_BUY_SOL` | 默认买入金额，默认 1 |
| `DEFAULT_SLIPPAGE_BPS` | 默认滑点 bps，默认 300（即 3%） |
| `STOP_LOSS_DROP_PCT` | 报警跌幅阈值，默认 50 |
| `TAKE_PROFIT_GAIN_PCT` | 止盈涨幅阈值，默认 100 |
| `FDV_MIN_USD` | 监控最低 FDV，默认 30000 |
| `LP_MIN_USD` | 监控最低 LP，默认 10000 |
| `X_DAILY_BUDGET_USD` | X API 日预算，默认 10 |
| `JITO_TIP_LAMPORTS` | Jito 小费，默认 100000（不用 Jito 设 0） |

## 模块成熟度说明

下列模块在本初始版本里已实现核心能力但留有 `TODO` 标记，按需补全：
- `services/xapi`：基础查询和缓存已实现，热度评分公式可按需调整
- `services/helius/holders.ts`：基于 RPC `getProgramAccounts` 实现，大代币慢，可换成 Helius DAS API
- 前端样式以功能为先，可自定义主题

## License

MIT - 仅供学习。链上交易有亏损风险，使用本软件造成的资金损失由使用者自行承担。
