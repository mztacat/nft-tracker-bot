import { getProvider, ERC721OwnerData, ERC1155HoldersData, CollectionHoldersData } from '../providers/index.js';
import { logger } from '../../logger.js';

const cache = new Map<string, { data: unknown; ts: number }>();
const HOLDER_CACHE_TTL = 30 * 60 * 1000; // 30 min

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < HOLDER_CACHE_TTL) return entry.data as T;
  return null;
}

function setCached(key: string, data: unknown): void {
  cache.set(key, { data, ts: Date.now() });
}

export async function getERC721Owner(
  contractAddress: string,
  tokenId: string,
  chain = 'ethereum'
): Promise<ERC721OwnerData | null> {
  const key = `erc721:${chain}:${contractAddress}:${tokenId}`;
  const cached = getCached<ERC721OwnerData>(key);
  if (cached) return cached;

  try {
    const data = await getProvider().getERC721Owner(contractAddress, tokenId, chain);
    if (data) setCached(key, data);
    return data;
  } catch (err) {
    logger.error({ err }, 'getERC721Owner failed');
    return null;
  }
}

export async function getERC1155Holders(
  contractAddress: string,
  tokenId: string,
  chain = 'ethereum'
): Promise<ERC1155HoldersData | null> {
  const key = `erc1155:${chain}:${contractAddress}:${tokenId}`;
  const cached = getCached<ERC1155HoldersData>(key);
  if (cached) return cached;

  try {
    const data = await getProvider().getERC1155Holders(contractAddress, tokenId, chain);
    if (data) setCached(key, data);
    return data;
  } catch (err) {
    logger.error({ err }, 'getERC1155Holders failed');
    return null;
  }
}

export async function getCollectionHolders(
  contractAddress: string,
  chain = 'ethereum'
): Promise<CollectionHoldersData | null> {
  const key = `colholder:${chain}:${contractAddress}`;
  const cached = getCached<CollectionHoldersData>(key);
  if (cached) return cached;

  try {
    const data = await getProvider().getCollectionHolders(contractAddress, chain);
    if (data) setCached(key, data);
    return data;
  } catch (err) {
    logger.error({ err }, 'getCollectionHolders failed');
    return null;
  }
}
