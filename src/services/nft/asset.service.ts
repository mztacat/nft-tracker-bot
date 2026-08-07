import { getProvider, AssetData } from '../providers/index.js';
import { prisma } from '../../db/client.js';
import { logger } from '../../logger.js';

const cache = new Map<string, { data: AssetData; ts: number }>();
const CACHE_TTL = 120_000;

export async function getAssetSummary(contractAddress: string, tokenId: string, chain = 'ethereum'): Promise<AssetData | null> {
  const cacheKey = `${chain}:${contractAddress}:${tokenId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const provider = getProvider();
    const data = await provider.getAssetData(contractAddress, tokenId, chain);
    if (data) cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch (err) {
    logger.error({ err, contractAddress, tokenId }, 'Failed to fetch asset summary');
    return null;
  }
}

export async function trackAsset(params: {
  chatId: number;
  userId: number;
  contractAddress: string;
  tokenId: string;
  chain?: string;
  collectionSlug?: string;
  label?: string;
}) {
  const { chatId, userId, contractAddress, tokenId, chain = 'ethereum', collectionSlug, label } = params;

  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(userId) } });
  if (!dbChat || !dbUser) throw new Error('Chat or user not found');

  const count = await prisma.trackedItem.count({
    where: { chatId: dbChat.id, type: 'ASSET', isActive: true },
  });
  const limit = parseInt(process.env.MAX_TRACKED_ASSETS ?? '20');
  if (count >= limit) throw new Error(`Maximum asset tracking limit (${limit}) reached`);

  const existing = await prisma.trackedItem.findFirst({
    where: { chatId: dbChat.id, type: 'ASSET', contractAddress, tokenId },
  });

  if (existing) {
    if (!existing.isActive) {
      await prisma.trackedItem.update({ where: { id: existing.id }, data: { isActive: true, isPaused: false } });
      return { created: false, reactivated: true, item: existing };
    }
    return { created: false, reactivated: false, item: existing };
  }

  const item = await prisma.trackedItem.create({
    data: {
      chatId: dbChat.id,
      ownerUserId: dbUser.id,
      type: 'ASSET',
      chain,
      contractAddress,
      tokenId,
      collectionSlug,
      label: label ?? `#${tokenId}`,
      isActive: true,
    },
  });

  const defaultEvents = ['ASSET_SOLD', 'OWNER_CHANGE', 'ASSET_LISTED', 'ASSET_DELISTED'];
  await prisma.notificationSetting.createMany({
    data: defaultEvents.map((eventType) => ({
      trackedItemId: item.id,
      chatId: dbChat.id,
      userId: dbUser.id,
      eventType,
      enabled: true,
      cooldownMinutes: 30,
    })),
    skipDuplicates: true,
  });

  return { created: true, reactivated: false, item };
}

export async function untrackAsset(chatId: number, trackedItemId: number) {
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (!dbChat) throw new Error('Chat not found');

  await prisma.trackedItem.updateMany({
    where: { id: trackedItemId, chatId: dbChat.id, type: 'ASSET' },
    data: { isActive: false },
  });
}

export async function listTrackedAssets(chatId: number) {
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (!dbChat) return [];
  return prisma.trackedItem.findMany({
    where: { chatId: dbChat.id, type: 'ASSET', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}
