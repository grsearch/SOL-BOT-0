import axios from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { Token } from '../../types/index.js';

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  url?: string;
  timestamp?: string;
}

export async function sendDiscord(content: string | null, embeds: DiscordEmbed[] = []): Promise<boolean> {
  if (!config.DISCORD_WEBHOOK_URL) {
    logger.warn('DISCORD_WEBHOOK_URL 未配置，跳过通知');
    return false;
  }
  try {
    await axios.post(config.DISCORD_WEBHOOK_URL, { content, embeds }, { timeout: 10_000 });
    return true;
  } catch (e: any) {
    logger.warn({ err: e?.response?.data ?? e?.message }, 'Discord webhook 发送失败');
    return false;
  }
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtAge(seconds: number | null): string {
  if (!seconds) return 'N/A';
  const h = Math.floor(seconds / 3600);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export async function sendDropAlert(token: Token, currentPrice: number, dropPct: number): Promise<boolean> {
  const gmgnUrl = `https://gmgn.ai/sol/token/${token.address}`;
  const embed: DiscordEmbed = {
    title: `🚨 跌幅报警：${token.symbol ?? '?'} 从 24h 高点已跌 ${dropPct.toFixed(1)}%`,
    description: `**CA:** \`${token.address}\`\n[查看 GMGN](${gmgnUrl})`,
    color: 0xff4444,
    timestamp: new Date().toISOString(),
    fields: [
      { name: 'Symbol', value: token.symbol ?? '?', inline: true },
      { name: '现价', value: fmtUsd(currentPrice), inline: true },
      { name: '24h 高点', value: fmtUsd(token.high_24h), inline: true },
      { name: 'FDV', value: fmtUsd(token.fdv_usd), inline: true },
      { name: 'LP', value: fmtUsd(token.lp_usd), inline: true },
      { name: 'Holders', value: token.holders?.toString() ?? 'N/A', inline: true },
      { name: 'Age', value: fmtAge(token.age_seconds), inline: true },
      { name: '24h Vol', value: fmtUsd(token.volume_24h_usd), inline: true },
      { name: 'X 提及(60m)', value: token.x_mentions_60m?.toString() ?? '0', inline: true },
    ],
  };
  return sendDiscord(null, [embed]);
}

export async function sendInfo(title: string, msg: string): Promise<boolean> {
  return sendDiscord(null, [{ title, description: msg, color: 0x4488ff, timestamp: new Date().toISOString() }]);
}
