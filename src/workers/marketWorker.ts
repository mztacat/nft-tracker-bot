import { prisma } from '../db/client.js';
import { getProvider } from '../services/providers/index.js';
import { logger } from '../logger.js';
import { config } from '../config/index.js';
import { processFloorChangeAlert, processSaleAlert } from '../services/alerts/alert.engine.js';

export async function runMarketWorker(): Promise<void> {
  logger.info('Market worker tick started');

  const activeItems = await prisma.trackedItem.findMany({
    where: { isActive: true, isPaused: false, type: 'COLLECTION' },
    include: {
      chat: true,
      notificationSettings: true,
    },
  });

  if (activeItems.length === 0) {
    logger.debug('No active collection items to poll');
    return;
  }

  const provider = getProvider();
  if (!provider.isAvailable()) {
    logger.warn('No NFT data provider available, skipping market worker tick');
    return;
  }

  for (const item of activeItems) {
    try {
      if (!item.collectionSlug) continue;

      const data = await provider.getCollectionData(item.collectionSlug, item.chain ?? 'ethereum');
      if (!data) continue;

      // Get previous snapshot
      const prev = await prisma.collectionSnapshot.findFirst({
        where: { trackedItemId: item.id },
        orderBy: { timestamp: 'desc' },
      });

      // Save new snapshot
      await prisma.collectionSnapshot.create({
        data: {
          trackedItemId: item.id,
          floorPrice: data.floorPrice ?? undefined,
          volume24h: data.volume24h ?? undefined,
          sales24h: data.sales24h ?? undefined,
          listingsCount: data.listingsCount ?? undefined,
          holdersCount: data.holdersCount ?? undefined,
        },
      });

      // Check floor change alert
      const floorNotif = item.notificationSettings.find((s) => s.eventType === 'FLOOR_CHANGE' && s.enabled);
      if (floorNotif && prev?.floorPrice && data.floorPrice) {
        const threshold = (floorNotif.thresholdJson as any)?.pct ?? 5;
        await processFloorChangeAlert({
          trackedItemId: item.id,
          telegramChatId: item.chat.telegramChatId,
          collectionName: item.label ?? item.collectionSlug,
          newFloor: data.floorPrice,
          prevFloor: prev.floorPrice,
          chain: item.chain ?? 'ethereum',
          thresholdPct: threshold,
        });
      }

      // Check sales spike alert
      const saleNotif = item.notificationSettings.find((s) => s.eventType === 'SALE' && s.enabled);
      if (saleNotif && data.sales24h && data.sales24h > 0) {
        const minPrice = (saleNotif.thresholdJson as any)?.minPrice ?? 0;
        // Only alert for significant sale spikes vs previous period
        if (prev?.sales24h && data.sales24h > prev.sales24h * 1.5) {
          await processSaleAlert({
            trackedItemId: item.id,
            telegramChatId: item.chat.telegramChatId,
            collectionName: item.label ?? item.collectionSlug,
            tokenId: 'various',
            price: data.volume24h && data.sales24h ? data.volume24h / data.sales24h : 0,
            minPrice,
          });
        }
      }

      // Rate limiting between requests
      await delay(200);
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Market worker: error processing item');
    }
  }

  logger.info({ count: activeItems.length }, 'Market worker tick complete');
}

async function runAssetWorker(): Promise<void> {
  logger.info('Asset worker tick started');

  const assetItems = await prisma.trackedItem.findMany({
    where: { isActive: true, isPaused: false, type: 'ASSET' },
    include: { chat: true, notificationSettings: true },
  });

  const provider = getProvider();

  for (const item of assetItems) {
    try {
      if (!item.contractAddress || !item.tokenId) continue;

      const data = await provider.getAssetData(item.contractAddress, item.tokenId, item.chain ?? 'ethereum');
      if (!data) continue;

      const prev = await prisma.assetSnapshot.findFirst({
        where: { trackedItemId: item.id },
        orderBy: { timestamp: 'desc' },
      });

      await prisma.assetSnapshot.create({
        data: {
          trackedItemId: item.id,
          ownerAddress: data.ownerAddress ?? undefined,
          listingPrice: data.listingPrice ?? undefined,
          lastSalePrice: data.lastSalePrice ?? undefined,
          status: data.isListed ? 'LISTED' : 'NOT_LISTED',
        },
      });

      // Check owner change
      const ownerNotif = item.notificationSettings.find((s) => s.eventType === 'OWNER_CHANGE' && s.enabled);
      if (ownerNotif && prev?.ownerAddress && data.ownerAddress && prev.ownerAddress !== data.ownerAddress) {
        const { processOwnerChangeAlert } = await import('../services/alerts/alert.engine.js');
        await processOwnerChangeAlert({
          trackedItemId: item.id,
          telegramChatId: item.chat.telegramChatId,
          collectionName: item.collectionSlug ?? 'Unknown',
          tokenId: item.tokenId,
          newOwner: data.ownerAddress,
          oldOwner: prev.ownerAddress,
        });
      }

      await delay(300);
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Asset worker: error processing item');
    }
  }

  logger.info({ count: assetItems.length }, 'Asset worker tick complete');
}

export { runAssetWorker };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
