import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

/**
 * Optional CoinGecko NFT API enhancer.
 * The free "Demo" API key is instant (no approval needed):
 * https://www.coingecko.com/en/api/pricing — sign up, create a demo key.
 * Supplies floor price, 24h floor change, 24h volume/sales, and holder count
 * looked up by contract address.
 */

const CG_BASE = 'https://api.coingecko.com/api/v3';

const CHAIN_PLATFORMS: Record<string, string> = {
  ethereum: 'ethereum',
  polygon: 'polygon-pos',
  arbitrum: 'arbitrum-one',
  optimism: 'optimistic-ethereum',
  base: 'base',
};

export interface CoinGeckoNftStats {
  floorPrice: number | null;
  floorChange24h: number | null;
  volume24h: number | null;
  sales24h: number | null;
  numOwners: number | null;
}

export function coinGeckoAvailable(): boolean {
  return Boolean(config.COINGECKO_API_KEY);
}

// Cache to respect the demo tier's 30 req/min limit
const cache = new Map<string, { data: CoinGeckoNftStats; ts: number }>();
const CACHE_TTL = 120_000;

export async function getCoinGeckoNftStats(
  contractAddress: string,
  chain = 'ethereum'
): Promise<CoinGeckoNftStats | null> {
  const key = `${chain}:${contractAddress.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const platform = CHAIN_PLATFORMS[chain] ?? 'ethereum';
  try {
    const res = await fetch(
      `${CG_BASE}/nfts/${platform}/contract/${contractAddress}`,
      {
        headers: {
          accept: 'application/json',
          'x-cg-demo-api-key': config.COINGECKO_API_KEY!,
        },
      }
    );
    if (!res.ok) {
      logger.warn({ contractAddress, status: res.status }, 'CoinGecko NFT API non-OK response');
      return null;
    }
    const data: any = await res.json();

    const stats: CoinGeckoNftStats = {
      floorPrice: data.floor_price?.native_currency ?? null,
      floorChange24h: data.floor_price_in_native_currency_24h_percentage_change ?? null,
      volume24h: data.volume_24h?.native_currency ?? null,
      sales24h: data.one_day_sales ?? null,
      numOwners: data.number_of_unique_addresses ?? null,
    };
    cache.set(key, { data: stats, ts: Date.now() });
    return stats;
  } catch (err) {
    logger.error({ err, contractAddress }, 'CoinGecko fetch error');
    return null;
  }
}
