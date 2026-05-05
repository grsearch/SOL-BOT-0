import axios, { AxiosInstance } from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

const BIRDEYE_BASE = 'https://public-api.birdeye.so';

export interface BirdeyeTokenOverview {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;             // USD
  priceChange24hPercent?: number;
  v24hUSD?: number;          // 24h volume in USD
  liquidity?: number;        // 池子 LP USD
  fdv?: number;
  mc?: number;
  holder?: number;
  numberMarkets?: number;
  // …还有更多字段，按需扩展
}

class BirdeyeClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: BIRDEYE_BASE,
      timeout: 15_000,
      headers: {
        'X-API-KEY': config.BIRDEYE_API_KEY,
        'x-chain': 'solana',
        accept: 'application/json',
      },
    });
  }

  /** 单个代币的元数据 + 价格 + LP + FDV。Premium Plus 应该可用 token_overview。 */
  async getTokenOverview(address: string): Promise<BirdeyeTokenOverview | null> {
    try {
      const r = await this.http.get('/defi/token_overview', { params: { address } });
      const d = r.data?.data;
      if (!d) return null;
      return {
        address,
        symbol: d.symbol,
        name: d.name,
        decimals: d.decimals,
        price: d.price,
        priceChange24hPercent: d.priceChange24hPercent,
        v24hUSD: d.v24hUSD,
        liquidity: d.liquidity,
        fdv: d.fdv,
        mc: d.mc,
        holder: d.holder,
        numberMarkets: d.numberMarkets,
      };
    } catch (e: any) {
      logger.warn({ err: e?.response?.status ?? e?.message, address }, 'birdeye getTokenOverview 失败');
      return null;
    }
  }

  /** 价格（轻量） */
  async getPrice(address: string): Promise<number | null> {
    try {
      const r = await this.http.get('/defi/price', { params: { address } });
      return r.data?.data?.value ?? null;
    } catch (e: any) {
      logger.warn({ err: e?.message, address }, 'birdeye getPrice 失败');
      return null;
    }
  }

  /** 代币创建时间（用于算 age） */
  async getTokenCreationInfo(address: string): Promise<{ createdAtUnix: number } | null> {
    try {
      const r = await this.http.get('/defi/token_creation_info', { params: { address } });
      const d = r.data?.data;
      if (!d?.blockUnixTime) return null;
      return { createdAtUnix: d.blockUnixTime };
    } catch (e: any) {
      logger.warn({ err: e?.message, address }, 'birdeye getTokenCreationInfo 失败');
      return null;
    }
  }
}

export const birdeye = new BirdeyeClient();
