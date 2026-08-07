import { getProvider, ERC721OwnerData, ERC1155HoldersData, CollectionHoldersData } from '../providers/index.js';
import { prisma } from '../../db/client.js';
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
    if (data) {
      await enrich24hHolderStats(contractAddress, data);
      setCached(key, data);
    }
    return data;
  } catch (err) {
    logger.error({ err }, 'getCollectionHolders failed');
    return null;
  }
}

/**
 * Fill holderChange24h / newHolders24h from holder-worker snapshots, when a
 * tracked item exists for this contract and a ~24h-old snapshot is available.
 * newHolders24h is the net gain in unique holders (0 when the base shrank).
 */
async function enrich24hHolderStats(
  contractAddress: string,
  data: CollectionHoldersData
): Promise<void> {
  if (data.uniqueHolders == null) return;
  try {
    const item = await prisma.trackedItem.findFirst({
      where: { contractAddress: { equals: contractAddress, mode: 'insensitive' }, isActive: true },
      select: { id: true },
    });
    if (!item) return;

    const now = Date.now();
    const baseline = await prisma.collectionSnapshot.findFirst({
      where: {
        trackedItemId: item.id,
        timestamp: {
          lte: new Date(now - 20 * 60 * 60 * 1000),
          gte: new Date(now - 48 * 60 * 60 * 1000),
        },
        holdersCount: { not: null },
      },
      orderBy: { timestamp: 'desc' },
    });
    if (!baseline?.holdersCount) return;

    const change = data.uniqueHolders - baseline.holdersCount;
    data.holderChange24h = change;
    data.newHolders24h = Math.max(0, change);
  } catch (err) {
    logger.warn({ err }, 'enrich24hHolderStats failed (non-fatal)');
  }
}
