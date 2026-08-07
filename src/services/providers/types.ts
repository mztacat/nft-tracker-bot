export interface CollectionData {
  name: string;
  slug: string;
  chain: string;
  contractAddress: string;
  floorPrice: number | null;
  volume24h: number | null;
  sales24h: number | null;
  floorChange24h: number | null;
  volumeChange24h: number | null;
  listingsCount: number | null;
  holdersCount: number | null;
  totalSupply: number | null;
  imageUrl?: string;
  description?: string;
  updatedAt: Date;
}

export interface AssetData {
  tokenId: string;
  contractAddress: string;
  chain: string;
  collectionName: string;
  collectionSlug: string;
  ownerAddress: string | null;
  isListed: boolean;
  listingPrice: number | null;
  lastSalePrice: number | null;
  floorPrice: number | null;
  rarityRank: number | null;
  tokenStandard: string | null;
  imageUrl?: string;
  name?: string;
  updatedAt: Date;
}

export interface HolderInfo {
  address: string;
  balance?: number;
  percentage?: number;
}

export interface ERC721OwnerData {
  currentOwner: string;
  ownerSince?: Date | null;
  lastTransferTime?: Date | null;
  previousOwner?: string | null;
  ownerNftCount?: number | null;
}

export interface ERC1155HoldersData {
  totalSupply: number;
  uniqueHolders: number;
  topHolders: HolderInfo[];
}

export interface CollectionHoldersData {
  uniqueHolders: number;
  totalSupply: number;
  topHolders: HolderInfo[];
  top10Concentration?: number | null;
  top50Concentration?: number | null;
  holderChange24h?: number | null;
  newHolders24h?: number | null;
}

export interface MarketDataProvider {
  getCollectionData(slug: string, chain?: string): Promise<CollectionData | null>;
  getAssetData(contractAddress: string, tokenId: string, chain?: string): Promise<AssetData | null>;
  isAvailable(): boolean;
}

export interface OwnershipDataProvider {
  getERC721Owner(contractAddress: string, tokenId: string, chain?: string): Promise<ERC721OwnerData | null>;
  getERC1155Holders(contractAddress: string, tokenId: string, chain?: string): Promise<ERC1155HoldersData | null>;
}

export interface HolderDataProvider {
  getCollectionHolders(contractAddress: string, chain?: string): Promise<CollectionHoldersData | null>;
}

export interface NftDataProvider extends MarketDataProvider, OwnershipDataProvider, HolderDataProvider {
  name: string;
}
