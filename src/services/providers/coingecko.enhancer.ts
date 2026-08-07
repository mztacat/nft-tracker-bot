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

// CoinGecko's public API works without a key (lower rate limit);
// a free demo key raises the limit, so we always consider it available.
export function coinGeckoAvailable(): boolean {
  return true;
}

function cgHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (config.COINGECKO_API_KEY) h['x-cg-demo-api-key'] = config.COINGECKO_API_KEY;
  return h;
}

export interface CoinGeckoNftInfo extends CoinGeckoNftStats {
  name: string;
  contractAddress: string;
  chain: string;
  imageUrl?: string;
  description?: string;
  totalSupply: number | null;
}

const slugCache = new Map<string, { data: CoinGeckoNftInfo | null; ts: number }>();

/**
 * Resolve an OpenSea-style slug directly: CoinGecko NFT ids match OpenSea
 * slugs (e.g. "kaito-genesis"), and the response carries the contract
 * address plus full market stats in one call.
 */
export async function getCoinGeckoNftBySlug(slug: string): Promise<CoinGeckoNftInfo | null> {
  const cached = slugCache.get(slug);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await fetch(`${CG_BASE}/nfts/${encodeURIComponent(slug)}`, { headers: cgHeaders() });
    if (!res.ok) {
      logger.warn({ slug, status: res.status }, 'CoinGecko NFT slug lookup non-OK');
      if (res.status === 404) slugCache.set(slug, { data: null, ts: Date.now() });
      return null;
    }
    const d: any = await res.json();
    if (!d.contract_address) return null;

    const info: CoinGeckoNftInfo = {
      name: d.name ?? slug,
      contractAddress: d.contract_address,
      chain: d.asset_platform_id === 'ethereum' ? 'ethereum' : d.asset_platform_id,
      imageUrl: d.image?.small_2x ?? d.image?.small ?? undefined,
      description: d.description ?? undefined,
      totalSupply: d.total_supply != null ? Number(d.total_supply) : null,
      floorPrice: d.floor_price?.native_currency ?? null,
      floorChange24h: d.floor_price_24h_percentage_change?.native_currency ?? null,
      volume24h: d.volume_24h?.native_currency ?? null,
      sales24h: d.one_day_sales ?? null,
      numOwners: d.number_of_unique_addresses ?? null,
    };
    slugCache.set(slug, { data: info, ts: Date.now() });
    return info;
  } catch (err) {
    logger.error({ err, slug }, 'CoinGecko slug lookup error');
    return null;
  }
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
      { headers: cgHeaders() }
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
