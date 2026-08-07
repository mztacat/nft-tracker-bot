import { prisma } from '../db/client.js';
import { logger } from '../logger.js';

export async function runAlertWorker(): Promise<void> {
  logger.info('Alert worker tick started');

  // Cleanup old alert history (keep last 30 days)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await prisma.alertHistory.deleteMany({ where: { sentAt: { lt: cutoff } } });
  if (deleted.count > 0) logger.info({ deleted: deleted.count }, 'Alert worker: pruned old alerts');

  // Digest alerts for items with digest mode enabled
  const digestItems = await prisma.trackedItem.findMany({
    where: {
      isActive: true,
      isPaused: false,
      type: 'COLLECTION',
      notificationSettings: {
        some: { eventType: 'DIGEST', enabled: true },
      },
    },
    include: { chat: true, notificationSettings: true },
  });

  for (const item of digestItems) {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const snapshots = await prisma.collectionSnapshot.findMany({
        where: { trackedItemId: item.id, timestamp: { gte: oneHourAgo } },
        orderBy: { timestamp: 'asc' },
      });

      if (snapshots.length < 2) continue;

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];

      const floorChange =
        first.floorPrice && last.floorPrice
          ? ((last.floorPrice - first.floorPrice) / first.floorPrice) * 100
          : null;

      const { sendDigestAlert } = await import('../services/alerts/alert.engine.js');
      await sendDigestAlert({
        trackedItemId: item.id,
        telegramChatId: item.chat.telegramChatId,
        collectionName: item.label ?? item.collectionSlug ?? 'Collection',
        stats: {
          sales: last.sales24h ?? 0,
          volume: last.volume24h ?? 0,
          floor: last.floorPrice ?? 0,
          floorChange,
          newListings: 0,
          delistings: 0,
          whaleBuys: 0,
        },
      });
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Alert worker: digest error');
    }
  }

  logger.info('Alert worker tick complete');
}
