import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

export interface PortfolioHolding {
  name: string;
  contractAddress: string;
  count: number;
  floorEth: number | null;
  estValueEth: number | null;
}

export interface WalletPortfolio {
  totalNfts: number;
  totalCollections: number;
  holdings: PortfolioHolding[]; // sorted by est value desc
  totalEstValueEth: number;
  pricedCollections: number; // how many collections had a floor price
}

/**
 * Wallet portfolio via Alchemy getContractsForOwner: per-collection balances
 * with names and OpenSea floor prices in a single paginated call.
 */
export async function getWalletPortfolio(owner: string, chain = 'ethereum'): Promise<WalletPortfolio | null> {
  const key = config.ALCHEMY_API_KEY;
  if (!key) return null;

  const hosts: Record<string, string> = {
    ethereum: 'eth-mainnet.g.alchemy.com',
    polygon: 'polygon-mainnet.g.alchemy.com',
    arbitrum: 'arb-mainnet.g.alchemy.com',
    optimism: 'opt-mainnet.g.alchemy.com',
    base: 'base-mainnet.g.alchemy.com',
  };
  const host = hosts[chain] ?? hosts['ethereum'];

  const contracts: any[] = [];
  let pageKey: string | undefined;
  try {
    for (let page = 0; page < 3; page++) {
      const url = new URL(`https://${host}/nft/v3/${key}/getContractsForOwner`);
      url.searchParams.set('owner', owner);
      url.searchParams.set('withMetadata', 'true');
      url.searchParams.set('pageSize', '100');
      if (pageKey) url.searchParams.set('pageKey', pageKey);

      const res = await fetch(url);
      if (!res.ok) {
        logger.warn({ status: res.status }, 'getContractsForOwner non-OK');
        break;
      }
      const data: any = await res.json();
      contracts.push(...(data?.contracts ?? []));
      pageKey = data?.pageKey;
      if (!pageKey) break;
    }
  } catch (err) {
    logger.error({ err, owner }, 'getWalletPortfolio failed');
    return null;
  }

  const holdings: PortfolioHolding[] = contracts.map((c: any) => {
    const count = parseInt(c.totalBalance ?? c.numDistinctTokensOwned ?? '0') || 0;
    const floorEth: number | null =
      typeof c.openSeaMetadata?.floorPrice === 'number' ? c.openSeaMetadata.floorPrice : null;
    return {
      name: c.name ?? c.openSeaMetadata?.collectionName ?? c.address,
      contractAddress: c.address,
      count,
      floorEth,
      estValueEth: floorEth != null ? floorEth * count : null,
    };
  });

  holdings.sort((a, b) => (b.estValueEth ?? 0) - (a.estValueEth ?? 0));

  return {
    totalNfts: holdings.reduce((s, h) => s + h.count, 0),
    totalCollections: holdings.length,
    holdings,
    totalEstValueEth: holdings.reduce((s, h) => s + (h.estValueEth ?? 0), 0),
    pricedCollections: holdings.filter((h) => h.estValueEth != null).length,
  };
}
