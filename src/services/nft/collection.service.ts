import { getProvider, CollectionData } from '../providers/index.js';
import { prisma } from '../../db/client.js';
import { logger } from '../../logger.js';

const cache = new Map<string, { data: CollectionData; ts: number }>();
const CACHE_TTL = 60_000;

export async function getCollectionSummary(slug: string, chain = 'ethereum'): Promise<CollectionData | null> {
  const cacheKey = `${chain}:${slug}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    const provider = getProvider();
    const data = await provider.getCollectionData(slug, chain);
    if (data) {
      cache.set(cacheKey, { data, ts: Date.now() });
    }
    return data;
  } catch (err) {
    logger.error({ err, slug }, 'Failed to fetch collection summary');
    return null;
  }
}

export async function trackCollection(params: {
  chatId: number;
  userId: number;
  slug: string;
  contractAddress?: string;
  chain?: string;
  label?: string;
}) {
  const { chatId, userId, slug, contractAddress, chain = 'ethereum', label } = params;

  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(userId) } });

  if (!dbChat || !dbUser) {
    throw new Error('Chat or user not found in database');
  }

  // Check limits
  const count = await prisma.trackedItem.count({
    where: { chatId: dbChat.id, type: 'COLLECTION', isActive: true },
  });

  const limit = parseInt(process.env.MAX_TRACKED_COLLECTIONS ?? '10');
  if (count >= limit) {
    throw new Error(`Maximum collection tracking limit (${limit}) reached`);
  }

  // Upsert tracked item
  const existing = await prisma.trackedItem.findFirst({
    where: {
      chatId: dbChat.id,
      type: 'COLLECTION',
      collectionSlug: slug,
    },
  });

  if (existing) {
    if (!existing.isActive) {
      await prisma.trackedItem.update({
        where: { id: existing.id },
        data: { isActive: true, isPaused: false },
      });
      return { created: false, reactivated: true, item: existing };
    }
    return { created: false, reactivated: false, item: existing };
  }

  const item = await prisma.trackedItem.create({
    data: {
      chatId: dbChat.id,
      ownerUserId: dbUser.id,
      type: 'COLLECTION',
      chain,
      collectionSlug: slug,
      contractAddress,
      label: label ?? slug,
      isActive: true,
    },
  });

  // Create default notification settings
  const defaultEvents = ['FLOOR_CHANGE', 'SALE', 'LISTING', 'WHALE_BUY'];
  const enabledByDefault = new Set(['FLOOR_CHANGE', 'WHALE_BUY', 'LISTING']);
  await prisma.notificationSetting.createMany({
    data: defaultEvents.map((eventType) => ({
      trackedItemId: item.id,
      chatId: dbChat.id,
      userId: dbUser.id,
      eventType,
      enabled: enabledByDefault.has(eventType),
      cooldownMinutes: eventType === 'FLOOR_CHANGE' ? 30 : 5,
    })),
    skipDuplicates: true,
  });

  return { created: true, reactivated: false, item };
}

export async function untrackCollection(chatId: number, userId: number, trackedItemId: number) {
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (!dbChat) throw new Error('Chat not found');

  await prisma.trackedItem.updateMany({
    where: {
      id: trackedItemId,
      chatId: dbChat.id,
      type: 'COLLECTION',
    },
    data: { isActive: false },
  });
}

export async function listTrackedCollections(chatId: number) {
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (!dbChat) return [];

  return prisma.trackedItem.findMany({
    where: { chatId: dbChat.id, type: 'COLLECTION', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}
