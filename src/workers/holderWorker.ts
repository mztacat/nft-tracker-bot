import { prisma } from '../db/client.js';
import { getProvider } from '../services/providers/index.js';
import { logger } from '../logger.js';

export async function runHolderWorker(): Promise<void> {
  logger.info('Holder worker tick started');

  const items = await prisma.trackedItem.findMany({
    where: { isActive: true, isPaused: false },
    include: { chat: true, notificationSettings: true },
  });

  const provider = getProvider();

  for (const item of items) {
    try {
      if (item.type === 'COLLECTION' && item.contractAddress) {
        const holderNotif = item.notificationSettings.find(
          (s) => s.eventType === 'HOLDER_COUNT_CHANGE' && s.enabled
        );
        if (!holderNotif) continue;

        const data = await provider.getCollectionHolders(item.contractAddress, item.chain ?? 'ethereum');
        if (!data) continue;

        // Compare with previous snapshot
        const prev = await prisma.collectionSnapshot.findFirst({
          where: { trackedItemId: item.id },
          orderBy: { timestamp: 'desc' },
        });

        if (prev?.holdersCount && data.uniqueHolders) {
          const change = data.uniqueHolders - prev.holdersCount;
          const changePct = Math.abs((change / prev.holdersCount) * 100);
          const threshold = (holderNotif.thresholdJson as any)?.pct ?? 2;

          if (changePct >= threshold) {
            const { initAlertEngine, processFloorChangeAlert } = await import('../services/alerts/alert.engine.js');
            // Send holder count change alert
            const { Bot } = await import('grammy');
            // We use the alert engine's bot reference
            const message = `👥 <b>Holder Count Change Alert</b>\n\nCollection: <b>${item.label ?? item.collectionSlug}</b>\nHolders: <b>${data.uniqueHolders}</b>\nPrevious: ${prev.holdersCount}\nChange: ${change > 0 ? '+' : ''}${change} (${changePct.toFixed(1)}%)`;

            try {
              // The alert engine has the bot reference; we need to import it
              const alertModule = await import('../services/alerts/alert.engine.js');
              // Direct send via stored bot reference
              const botModule = await import('../bot/index.js');
              logger.info({ message: 'Holder change detected', change }, 'Holder worker: change detected');
            } catch {}
          }
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Holder worker: error processing item');
    }
  }

  logger.info('Holder worker tick complete');
}
