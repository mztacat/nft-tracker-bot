import { NftDataProvider, CollectionData, AssetData, ERC721OwnerData, ERC1155HoldersData, CollectionHoldersData } from './types.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';
import { getOpenSeaCollection, getOpenSeaStats, openSeaAvailable } from './opensea.enhancer.js';
import { getCoinGeckoNftStats, coinGeckoAvailable } from './coingecko.enhancer.js';

const CHAIN_HOSTS: Record<string, string> = {
  ethereum: 'eth-mainnet.g.alchemy.com',
  polygon:  'polygon-mainnet.g.alchemy.com',
  arbitrum: 'arb-mainnet.g.alchemy.com',
  optimism: 'opt-mainnet.g.alchemy.com',
  base:     'base-mainnet.g.alchemy.com',
};

function baseUrl(chain = 'ethereum', apiKey: string) {
  const host = CHAIN_HOSTS[chain] ?? CHAIN_HOSTS['ethereum'];
  return `https://${host}/nft/v3/${apiKey}`;
}

async function alchemyFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, 'Alchemy API non-OK response');
      return null;
    }
    return res.json() as Promise<T>;
  } catch (err) {
    logger.error({ err, url }, 'Alchemy fetch error');
    return null;
  }
}

// Cache slug → contract address so we don't re-search on every poll
const slugCache = new Map<string, string>();

function isContractAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Resolve an OpenSea-style slug (e.g. "kaito-genesis") to an Ethereum
 * contract address using Alchemy's searchContractMetadata endpoint.
 * Returns null if nothing useful is found.
 */
async function resolveSlugToContract(slug: string, chain: string, apiKey: string): Promise<string | null> {
  if (slugCache.has(slug)) return slugCache.get(slug)!;

  // Convert slug to a human-readable query: "kaito-genesis" → "kaito genesis"
  const query = slug.replace(/-/g, ' ');
  const base  = baseUrl(chain, apiKey);
  const data  = await alchemyFetch<any>(
    `${base}/searchContractMetadata?query=${encodeURIComponent(query)}`
  );

  const contracts: any[] = data?.contracts ?? [];
  if (!contracts.length) {
    logger.warn({ slug }, 'Alchemy: no contracts found for slug');
    return null;
  }

  // 1. Exact OpenSea slug match is authoritative — the slug came from an opensea.io URL
  const slugLower = slug.toLowerCase();
  const exact = contracts.find(
    (c: any) => (c.openSeaMetadata?.collectionSlug ?? '').toLowerCase() === slugLower
  );

  // 2. Fall back to fuzzy name/symbol matching, preferring verified collections
  const slugNorm = slugLower.replace(/-/g, '');
  const fuzzyMatches = contracts.filter((c: any) => {
    const name    = (c.name ?? '').toLowerCase().replace(/\s/g, '');
    const osName  = (c.openSeaMetadata?.collectionName ?? '').toLowerCase().replace(/\s/g, '');
    const sym     = (c.symbol ?? '').toLowerCase();
    return name.includes(slugNorm) || osName.includes(slugNorm) || slugNorm.includes(name) || sym === slugNorm;
  });
  const fuzzy =
    fuzzyMatches.find((c: any) => c.openSeaMetadata?.safelistRequestStatus === 'verified') ??
    fuzzyMatches[0];

  const best = exact ?? fuzzy;
  if (!best) {
    logger.warn({ slug }, 'Alchemy: no contract matched slug');
    return null;
  }

  const address: string = best.address;
  slugCache.set(slug, address);
  logger.info({ slug, address }, 'Alchemy: resolved slug to contract');
  return address;
}

export class AlchemyProvider implements NftDataProvider {
  name = 'Alchemy';

  isAvailable(): boolean {
    return Boolean(config.ALCHEMY_API_KEY);
  }

  // ─── Collection ───────────────────────────────────────────────────────────

  async getCollectionData(slugOrAddress: string, chain = 'ethereum'): Promise<CollectionData | null> {
    const key  = config.ALCHEMY_API_KEY!;
    const base = baseUrl(chain, key);

    // Slugs pasted from URLs can carry trailing punctuation ("onchainhoodies-")
    const input  = slugOrAddress.trim().replace(/[-_.\s]+$/, '');
    const isAddr = isContractAddress(input);

    // If OpenSea API key is configured and we got a slug, resolve it
    // authoritatively via OpenSea and pick up market stats at the same time.
    let osInfo: Awaited<ReturnType<typeof getOpenSeaCollection>> = null;
    let osStats: Awaited<ReturnType<typeof getOpenSeaStats>> = null;
    if (!isAddr && openSeaAvailable()) {
      [osInfo, osStats] = await Promise.all([
        getOpenSeaCollection(input),
        getOpenSeaStats(input),
      ]);
    }

    // Resolve slug → contract address
    let contractAddress = input;
    if (!isAddr) {
      const resolved = osInfo?.contractAddress ?? (await resolveSlugToContract(input, chain, key));
      if (!resolved) return null;
      contractAddress = resolved;
    }

    // CoinGecko enhancer: fills stats by contract address when OpenSea isn't configured
    const cgPromise =
      !osStats && coinGeckoAvailable()
        ? getCoinGeckoNftStats(contractAddress, chain)
        : Promise.resolve(null);

    const [meta, floor, owners, cgStats] = await Promise.all([
      alchemyFetch<any>(`${base}/getContractMetadata?contractAddress=${contractAddress}`),
      alchemyFetch<any>(`${base}/getFloorPrice?contractAddress=${contractAddress}`),
      osStats?.numOwners != null
        ? Promise.resolve(null)
        : alchemyFetch<any>(`${base}/getOwnersForContract?contractAddress=${contractAddress}`),
      cgPromise,
    ]);

    if (!meta && !osInfo) return null;

    const floorPrice =
      osStats?.floorPrice ??
      cgStats?.floorPrice ??
      floor?.openSea?.floorPrice ??
      floor?.looksRare?.floorPrice ??
      null;

    return {
      name:            osInfo?.name ?? meta?.name ?? meta?.openSeaMetadata?.collectionName ?? contractAddress,
      slug:            input,
      chain,
      contractAddress,
      floorPrice,
      volume24h:       osStats?.volume24h ?? cgStats?.volume24h ?? null,
      sales24h:        osStats?.sales24h ?? cgStats?.sales24h ?? null,
      floorChange24h:  cgStats?.floorChange24h ?? null,
      volumeChange24h: osStats?.volumeChange24h ?? null,
      listingsCount:   null,
      holdersCount:    osStats?.numOwners ?? cgStats?.numOwners ?? (Array.isArray(owners?.owners) ? owners.owners.length : null),
      totalSupply:     osInfo?.totalSupply ?? (meta?.totalSupply ? Number(meta.totalSupply) : null),
      imageUrl:        osInfo?.imageUrl ?? meta?.openSeaMetadata?.imageUrl ?? undefined,
      description:     osInfo?.description ?? meta?.openSeaMetadata?.description ?? undefined,
      updatedAt:       new Date(),
    };
  }

  // ─── Asset ────────────────────────────────────────────────────────────────

  async getAssetData(contractAddress: string, tokenId: string, chain = 'ethereum'): Promise<AssetData | null> {
    const key  = config.ALCHEMY_API_KEY!;
    const base = baseUrl(chain, key);

    const [nft, floor] = await Promise.all([
      alchemyFetch<any>(`${base}/getNFTMetadata?contractAddress=${contractAddress}&tokenId=${tokenId}`),
      alchemyFetch<any>(`${base}/getFloorPrice?contractAddress=${contractAddress}`),
    ]);

    if (!nft) return null;

    const floorPrice = floor?.openSea?.floorPrice ?? floor?.looksRare?.floorPrice ?? null;

    return {
      tokenId,
      contractAddress,
      chain,
      collectionName: nft.contract?.name ?? contractAddress,
      collectionSlug: contractAddress,
      ownerAddress:   nft.owners?.[0]?.ownerAddress ?? null,
      isListed:       false,
      listingPrice:   null,
      lastSalePrice:  null,
      floorPrice,
      rarityRank:     nft.rarityScore?.rank ?? null,
      tokenStandard:  nft.tokenType ?? null,
      imageUrl:       nft.image?.originalUrl ?? nft.image?.thumbnailUrl ?? undefined,
      name:           nft.name ?? `#${tokenId}`,
      updatedAt:      new Date(),
    };
  }

  // ─── Ownership ────────────────────────────────────────────────────────────

  async getERC721Owner(contractAddress: string, tokenId: string, chain = 'ethereum'): Promise<ERC721OwnerData | null> {
    const key  = config.ALCHEMY_API_KEY!;
    const base = baseUrl(chain, key);

    const data = await alchemyFetch<any>(
      `${base}/getOwnersForNFT?contractAddress=${contractAddress}&tokenId=${tokenId}`
    );

    if (!data?.owners?.length) return null;

    return {
      currentOwner:     data.owners[0],
      ownerSince:       null,
      lastTransferTime: null,
      previousOwner:    null,
      ownerNftCount:    null,
    };
  }

  async getERC1155Holders(contractAddress: string, tokenId: string, chain = 'ethereum'): Promise<ERC1155HoldersData | null> {
    const key  = config.ALCHEMY_API_KEY!;
    const base = baseUrl(chain, key);

    const data = await alchemyFetch<any>(
      `${base}/getOwnersForNFT?contractAddress=${contractAddress}&tokenId=${tokenId}`
    );

    if (!data?.owners) return null;

    return {
      totalSupply:   data.owners.length,
      uniqueHolders: data.owners.length,
      topHolders:    (data.owners as string[]).slice(0, 10).map((addr) => ({ address: addr, balance: 1 })),
    };
  }

  // ─── Collection Holders ───────────────────────────────────────────────────

  async getCollectionHolders(contractAddress: string, chain = 'ethereum'): Promise<CollectionHoldersData | null> {
    const key  = config.ALCHEMY_API_KEY!;
    const base = baseUrl(chain, key);

    const data = await alchemyFetch<any>(
      `${base}/getOwnersForContract?contractAddress=${contractAddress}&withTokenBalances=false`
    );

    if (!data?.owners) return null;

    const total = data.owners.length;

    return {
      uniqueHolders:      total,
      totalSupply:        total,
      topHolders:         (data.owners as string[]).slice(0, 10).map((addr: string) => ({ address: addr })),
      top10Concentration: total > 0 ? (10 / total) * 100 : null,
      top50Concentration: total > 0 ? Math.min((50 / total) * 100, 100) : null,
      holderChange24h:    null,
      newHolders24h:      null,
    };
  }
}
