import {
  NftDataProvider,
  CollectionData,
  AssetData,
  ERC721OwnerData,
  ERC1155HoldersData,
  CollectionHoldersData,
} from './types.js';

const MOCK_COLLECTIONS: Record<string, CollectionData> = {
  azuki: {
    name: 'Azuki',
    slug: 'azuki',
    chain: 'ethereum',
    contractAddress: '0xed5af388653567af2f388e6224dc7c4b3241c544',
    floorPrice: 6.48,
    volume24h: 51.4,
    sales24h: 8,
    floorChange24h: 6.2,
    volumeChange24h: 12.5,
    listingsCount: 420,
    holdersCount: 5241,
    totalSupply: 10000,
    updatedAt: new Date(),
  },
  boredapeyachtclub: {
    name: 'Bored Ape Yacht Club',
    slug: 'boredapeyachtclub',
    chain: 'ethereum',
    contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    floorPrice: 11.5,
    volume24h: 230.0,
    sales24h: 20,
    floorChange24h: -2.5,
    volumeChange24h: -8.0,
    listingsCount: 980,
    holdersCount: 6420,
    totalSupply: 10000,
    updatedAt: new Date(),
  },
};

const MOCK_ASSETS: Record<string, AssetData> = {
  '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d:1234': {
    tokenId: '1234',
    contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    chain: 'ethereum',
    collectionName: 'Bored Ape Yacht Club',
    collectionSlug: 'boredapeyachtclub',
    ownerAddress: '0xabc123def456abc123def456abc123def456abc1',
    isListed: true,
    listingPrice: 12.5,
    lastSalePrice: 10.8,
    floorPrice: 11.5,
    rarityRank: 342,
    tokenStandard: 'ERC-721',
    name: 'Bored Ape #1234',
    updatedAt: new Date(),
  },
};

export class MockProvider implements NftDataProvider {
  name = 'mock';

  isAvailable(): boolean {
    return true;
  }

  async getCollectionData(slug: string): Promise<CollectionData | null> {
    await delay(100);
    const normalizedSlug = slug.toLowerCase().replace(/[-_\s]/g, '');
    for (const [key, data] of Object.entries(MOCK_COLLECTIONS)) {
      if (key === normalizedSlug || data.slug === slug) {
        return { ...data, updatedAt: new Date() };
      }
    }
    // Return generic mock for unknown collections
    return {
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      slug,
      chain: 'ethereum',
      contractAddress: '0x' + '0'.repeat(40),
      floorPrice: Math.random() * 5,
      volume24h: Math.random() * 100,
      sales24h: Math.floor(Math.random() * 20),
      floorChange24h: (Math.random() - 0.5) * 20,
      volumeChange24h: (Math.random() - 0.5) * 30,
      listingsCount: Math.floor(Math.random() * 500),
      holdersCount: Math.floor(Math.random() * 5000) + 1000,
      totalSupply: 10000,
      updatedAt: new Date(),
    };
  }

  async getAssetData(contractAddress: string, tokenId: string): Promise<AssetData | null> {
    await delay(100);
    const key = `${contractAddress}:${tokenId}`;
    if (MOCK_ASSETS[key]) {
      return { ...MOCK_ASSETS[key], updatedAt: new Date() };
    }
    return {
      tokenId,
      contractAddress,
      chain: 'ethereum',
      collectionName: 'Unknown Collection',
      collectionSlug: 'unknown',
      ownerAddress: '0x' + 'a'.repeat(40),
      isListed: false,
      listingPrice: null,
      lastSalePrice: Math.random() * 5,
      floorPrice: Math.random() * 3,
      rarityRank: Math.floor(Math.random() * 10000),
      tokenStandard: 'ERC-721',
      name: `Token #${tokenId}`,
      updatedAt: new Date(),
    };
  }

  async getERC721Owner(contractAddress: string, tokenId: string): Promise<ERC721OwnerData | null> {
    await delay(100);
    return {
      currentOwner: '0x' + 'b'.repeat(40),
      ownerSince: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lastTransferTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      previousOwner: '0x' + 'c'.repeat(40),
      ownerNftCount: 12,
    };
  }

  async getERC1155Holders(contractAddress: string, tokenId: string): Promise<ERC1155HoldersData | null> {
    await delay(100);
    return {
      totalSupply: 1000,
      uniqueHolders: 250,
      topHolders: [
        { address: '0x' + 'a'.repeat(40), balance: 50, percentage: 5.0 },
        { address: '0x' + 'b'.repeat(40), balance: 30, percentage: 3.0 },
        { address: '0x' + 'c'.repeat(40), balance: 20, percentage: 2.0 },
      ],
    };
  }

  async getCollectionHolders(contractAddress: string): Promise<CollectionHoldersData | null> {
    await delay(100);
    return {
      uniqueHolders: 5241,
      totalSupply: 10000,
      topHolders: [
        { address: '0x' + 'a'.repeat(40), balance: 200, percentage: 2.0 },
        { address: '0x' + 'b'.repeat(40), balance: 150, percentage: 1.5 },
        { address: '0x' + 'c'.repeat(40), balance: 100, percentage: 1.0 },
        { address: '0x' + 'd'.repeat(40), balance: 80, percentage: 0.8 },
        { address: '0x' + 'e'.repeat(40), balance: 60, percentage: 0.6 },
      ],
      top10Concentration: 12.5,
      top50Concentration: 38.2,
      holderChange24h: 15,
      newHolders24h: 23,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
