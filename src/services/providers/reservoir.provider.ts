import {
  NftDataProvider,
  CollectionData,
  AssetData,
  ERC721OwnerData,
  ERC1155HoldersData,
  CollectionHoldersData,
} from './types.js';
import { logger } from '../../logger.js';
import { config } from '../../config/index.js';

const BASE_URL = 'https://api.reservoir.tools';

async function reservoirFetch(path: string): Promise<unknown> {
  const apiKey = config.RESERVOIR_API_KEY;
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'x-api-key': apiKey ?? '',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Reservoir API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export class ReservoirProvider implements NftDataProvider {
  name = 'reservoir';

  isAvailable(): boolean {
    return !!config.RESERVOIR_API_KEY;
  }

  async getCollectionData(slug: string): Promise<CollectionData | null> {
    try {
      const data = await reservoirFetch(
        `/collections/v7?slug=${encodeURIComponent(slug)}&limit=1`
      ) as any;
      const c = data?.collections?.[0];
      if (!c) return null;

      return {
        name: c.name,
        slug: c.slug,
        chain: 'ethereum',
        contractAddress: c.primaryContract ?? '',
        floorPrice: c.floorAsk?.price?.amount?.native ?? null,
        volume24h: c.volume?.['1day'] ?? null,
        sales24h: c.salesCount?.['1day'] ?? null,
        floorChange24h: c.floorSaleChange?.['1day'] ? c.floorSaleChange['1day'] * 100 : null,
        volumeChange24h: null,
        listingsCount: c.onSaleCount ?? null,
        holdersCount: c.ownerCount ?? null,
        totalSupply: c.tokenCount ?? null,
        updatedAt: new Date(),
      };
    } catch (err) {
      logger.error({ err, slug }, 'Reservoir: getCollectionData failed');
      return null;
    }
  }

  async getAssetData(contractAddress: string, tokenId: string): Promise<AssetData | null> {
    try {
      const data = await reservoirFetch(
        `/tokens/v7?tokens=${contractAddress}:${tokenId}`
      ) as any;
      const t = data?.tokens?.[0]?.token;
      const market = data?.tokens?.[0]?.market;
      if (!t) return null;

      return {
        tokenId,
        contractAddress,
        chain: 'ethereum',
        collectionName: t.collection?.name ?? 'Unknown',
        collectionSlug: t.collection?.slug ?? '',
        ownerAddress: t.owner ?? null,
        isListed: !!market?.floorAsk?.price,
        listingPrice: market?.floorAsk?.price?.amount?.native ?? null,
        lastSalePrice: t.lastSale?.price?.amount?.native ?? null,
        floorPrice: market?.floorAsk?.price?.amount?.native ?? null,
        rarityRank: t.rarityRank ?? null,
        tokenStandard: t.kind ?? null,
        name: t.name ?? `#${tokenId}`,
        updatedAt: new Date(),
      };
    } catch (err) {
      logger.error({ err, contractAddress, tokenId }, 'Reservoir: getAssetData failed');
      return null;
    }
  }

  async getERC721Owner(contractAddress: string, tokenId: string): Promise<ERC721OwnerData | null> {
    try {
      const data = await reservoirFetch(
        `/tokens/v7?tokens=${contractAddress}:${tokenId}&includeAttributes=false`
      ) as any;
      const t = data?.tokens?.[0]?.token;
      if (!t) return null;

      return {
        currentOwner: t.owner ?? '',
        lastTransferTime: t.lastFlagUpdate ? new Date(t.lastFlagUpdate) : null,
        ownerSince: null,
        previousOwner: null,
        ownerNftCount: null,
      };
    } catch (err) {
      logger.error({ err }, 'Reservoir: getERC721Owner failed');
      return null;
    }
  }

  async getERC1155Holders(contractAddress: string, tokenId: string): Promise<ERC1155HoldersData | null> {
    try {
      const data = await reservoirFetch(
        `/owners/v2?token=${contractAddress}:${tokenId}&limit=10`
      ) as any;
      const owners = data?.owners ?? [];
      return {
        totalSupply: data?.totalSupply ?? 0,
        uniqueHolders: data?.uniqueOwners ?? owners.length,
        topHolders: owners.map((o: any) => ({
          address: o.address,
          balance: o.ownership?.tokenCount,
          percentage: o.ownership?.ownershipPercentage
            ? parseFloat(o.ownership.ownershipPercentage) * 100
            : undefined,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Reservoir: getERC1155Holders failed');
      return null;
    }
  }

  async getCollectionHolders(contractAddress: string): Promise<CollectionHoldersData | null> {
    try {
      const data = await reservoirFetch(
        `/owners/v2?contract=${contractAddress}&limit=50`
      ) as any;
      const [coll] = (await reservoirFetch(
        `/collections/v7?contract=${contractAddress}&limit=1`
      ) as any)?.collections ?? [];

      const owners = data?.owners ?? [];
      return {
        uniqueHolders: coll?.ownerCount ?? data?.uniqueOwners ?? 0,
        totalSupply: coll?.tokenCount ?? 0,
        topHolders: owners.slice(0, 10).map((o: any) => ({
          address: o.address,
          balance: o.ownership?.tokenCount,
          percentage: o.ownership?.ownershipPercentage
            ? parseFloat(o.ownership.ownershipPercentage) * 100
            : undefined,
        })),
        top10Concentration: null,
        top50Concentration: null,
        holderChange24h: null,
        newHolders24h: null,
      };
    } catch (err) {
      logger.error({ err }, 'Reservoir: getCollectionHolders failed');
      return null;
    }
  }
}
