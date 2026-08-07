import { NftDataProvider, CollectionData, AssetData, ERC721OwnerData, ERC1155HoldersData, CollectionHoldersData } from './types.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

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

export class AlchemyProvider implements NftDataProvider {
  name = 'Alchemy';

  isAvailable(): boolean {
    return Boolean(config.ALCHEMY_API_KEY);
  }

  // ─── Collection ───────────────────────────────────────────────────────────

  async getCollectionData(contractAddress: string, chain = 'ethereum'): Promise<CollectionData | null> {
    const key = config.ALCHEMY_API_KEY!;
    const base = baseUrl(chain, key);

    const [meta, floor] = await Promise.all([
      alchemyFetch<any>(`${base}/getContractMetadata?contractAddress=${contractAddress}`),
      alchemyFetch<any>(`${base}/getFloorPrice?contractAddress=${contractAddress}`),
    ]);

    if (!meta) return null;

    const osFloor   = floor?.openSea?.floorPrice   ?? null;
    const looksFloor = floor?.looksRare?.floorPrice ?? null;
    const floorPrice = osFloor ?? looksFloor ?? null;

    return {
      name:             meta.name ?? meta.contractDeployer ?? contractAddress,
      slug:             contractAddress,
      chain,
      contractAddress,
      floorPrice,
      volume24h:        floor?.openSea?.collectionUrl ? null : null, // not available from this endpoint
      sales24h:         null,
      floorChange24h:   null,
      volumeChange24h:  null,
      listingsCount:    null,
      holdersCount:     null,
      totalSupply:      meta.totalSupply ? Number(meta.totalSupply) : null,
      imageUrl:         meta.openSeaMetadata?.imageUrl ?? undefined,
      description:      meta.openSeaMetadata?.description ?? undefined,
      updatedAt:        new Date(),
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

    const floorPrice  = floor?.openSea?.floorPrice ?? floor?.looksRare?.floorPrice ?? null;
    const lastSale    = nft.contract?.openSeaMetadata?.lastIngestedAt ? null : null;
    const ownerAddr   = nft.owners?.[0]?.ownerAddress ?? null;

    return {
      tokenId,
      contractAddress,
      chain,
      collectionName: nft.contract?.name ?? contractAddress,
      collectionSlug: contractAddress,
      ownerAddress:   ownerAddr,
      isListed:       false,
      listingPrice:   null,
      lastSalePrice:  lastSale,
      floorPrice,
      rarityRank:     nft.rarityScore?.rankingType ? nft.rarityScore.rank ?? null : null,
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

    const topHolders = (data.owners as string[]).slice(0, 10).map((addr) => ({
      address: addr,
      balance: 1,
    }));

    return {
      totalSupply:   data.owners.length,
      uniqueHolders: data.owners.length,
      topHolders,
    };
  }

  // ─── Collection Holders ───────────────────────────────────────────────────

  async getCollectionHolders(contractAddress: string, chain = 'ethereum'): Promise<CollectionHoldersData | null> {
    const key  = config.ALCHEMY_API_KEY!;
    const base = baseUrl(chain, key);

    // Alchemy paginates; fetch first page to get owner count estimate
    const data = await alchemyFetch<any>(
      `${base}/getOwnersForContract?contractAddress=${contractAddress}&withTokenBalances=false`
    );

    if (!data?.owners) return null;

    const total = data.owners.length;
    const topHolders = (data.owners as string[]).slice(0, 10).map((addr: string) => ({
      address: addr,
    }));

    return {
      uniqueHolders:      total,
      totalSupply:        total,
      topHolders,
      top10Concentration: total > 0 ? (10 / total) * 100 : null,
      top50Concentration: total > 0 ? Math.min((50 / total) * 100, 100) : null,
      holderChange24h:    null,
      newHolders24h:      null,
    };
  }
}
