import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

const CHAIN_HOSTS: Record<string, string> = {
  ethereum: 'eth-mainnet.g.alchemy.com',
  polygon:  'polygon-mainnet.g.alchemy.com',
  arbitrum: 'arb-mainnet.g.alchemy.com',
  optimism: 'opt-mainnet.g.alchemy.com',
  base:     'base-mainnet.g.alchemy.com',
};

// contract -> name (or null when lookup failed; retried after TTL)
const cache = new Map<string, { name: string | null; at: number }>();
const TTL_MS = 24 * 60 * 60_000;

/** Resolve a collection name for a contract, cached for 24h. */
export async function getContractName(contractAddress: string, chain = 'ethereum'): Promise<string | null> {
  const key = `${chain}:${contractAddress.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;

  let name: string | null = null;
  if (config.ALCHEMY_API_KEY) {
    try {
      const host = CHAIN_HOSTS[chain] ?? CHAIN_HOSTS['ethereum'];
      const res = await fetch(
        `https://${host}/nft/v3/${config.ALCHEMY_API_KEY}/getContractMetadata?contractAddress=${contractAddress}`
      );
      if (res.ok) {
        const meta: any = await res.json();
        name = meta?.name ?? meta?.openSeaMetadata?.collectionName ?? null;
      }
    } catch (err) {
      logger.warn({ err, contractAddress }, 'getContractName lookup failed');
    }
  }

  cache.set(key, { name, at: Date.now() });
  if (cache.size > 2000) cache.clear();
  return name;
}
