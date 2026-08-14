import { logger } from '../logger.js';

let cachedPrice: number | null = null;
let lastFetchMs = 0;
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

/** Return cached ETH/USD price synchronously (may be null before first fetch). */
export function getCachedEthPrice(): number | null {
  return cachedPrice;
}

/** Fetch ETH/USD from CoinGecko (keyless free endpoint), cache for 5 min. */
export async function getEthUsdPrice(): Promise<number | null> {
  if (cachedPrice !== null && Date.now() - lastFetchMs < CACHE_TTL_MS) {
    return cachedPrice;
  }
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) return cachedPrice;
    const json: any = await res.json();
    const price = json?.ethereum?.usd;
    if (typeof price === 'number' && price > 0) {
      cachedPrice = price;
      lastFetchMs = Date.now();
    }
  } catch (err) {
    logger.debug({ err }, 'eth-price: fetch failed, using cached value');
  }
  return cachedPrice;
}

/** Format ETH with optional USD bracket: "0.12 ETH [$XXX]" */
export function fmtEthUsd(eth: number, decimals = 4): string {
  const ethStr = `${eth.toFixed(decimals)} ETH`;
  if (!cachedPrice || eth === 0) return ethStr;
  const usd = eth * cachedPrice;
  const usdStr = usd >= 1_000_000
    ? `$${(usd / 1_000_000).toFixed(2)}M`
    : usd >= 1_000
    ? `$${(usd / 1_000).toFixed(1)}K`
    : `$${usd.toFixed(0)}`;
  return `${ethStr} [${usdStr}]`;
}
