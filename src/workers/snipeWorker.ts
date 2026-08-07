import { prisma } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config/index.js';
import { processGenericAlert } from '../services/alerts/alert.engine.js';
import { formatSnipeAlert } from '../services/formatter/index.js';

/**
 * Below-floor listing sniper. Uses OpenSea's best-listings endpoint
 * (requires OPENSEA_API_KEY) and compares against the latest floor snapshot.
 */

const alertedOrders = new Set<string>();

export async function runSnipeWorker(): Promise<void> {
  if (!config.OPENSEA_API_KEY) return;

  const items = await prisma.trackedItem.findMany({
    where: {
      isActive: true,
      isPaused: false,
      type: 'COLLECTION',
      collectionSlug: { not: null },
      notificationSettings: { some: { eventType: 'LISTING', enabled: true } },
    },
    include: { chat: true, notificationSettings: true },
  });
  if (!items.length) return;

  for (const item of items) {
    try {
      const slug = item.collectionSlug!;

      // Latest known floor from snapshots
      const snap = await prisma.collectionSnapshot.findFirst({
        where: { trackedItemId: item.id, floorPrice: { not: null } },
        orderBy: { timestamp: 'desc' },
      });
      const floor = snap?.floorPrice;
      if (!floor || floor <= 0) continue;

      const res = await fetch(
        `https://api.opensea.io/api/v2/listings/collection/${encodeURIComponent(slug)}/best?limit=10`,
        { headers: { accept: 'application/json', 'x-api-key': config.OPENSEA_API_KEY! } }
      );
      if (!res.ok) {
        logger.warn({ slug, status: res.status }, 'Snipe worker: OpenSea listings non-OK');
        continue;
      }
      const data: any = await res.json();
      const listings: any[] = data?.listings ?? [];

      const setting = item.notificationSettings.find((s) => s.eventType === 'LISTING');
      // Alert when listed at least this % below the last known floor
      const minBelowPct = (setting?.thresholdJson as any)?.belowPct ?? 1;

      for (const l of listings) {
        const orderHash: string = l.order_hash ?? '';
        if (!orderHash || alertedOrders.has(orderHash)) continue;

        const cur = l.price?.current;
        if (!cur || (cur.currency !== 'ETH' && cur.currency !== 'WETH')) continue;
        const price = Number(cur.value) / 10 ** (cur.decimals ?? 18);
        if (!isFinite(price) || price <= 0) continue;

        const belowPct = ((floor - price) / floor) * 100;
        if (belowPct < minBelowPct) continue;

        const offer = l.protocol_data?.parameters?.offer?.[0];
        const tokenId: string | null = offer?.identifierOrCriteria ?? null;
        const contract: string | null = offer?.token ?? item.contractAddress ?? null;
        const url =
          contract && tokenId
            ? `https://opensea.io/assets/ethereum/${contract}/${tokenId}`
            : `https://opensea.io/collection/${slug}`;

        const message = formatSnipeAlert({
          collectionName: item.label ?? slug,
          tokenId,
          price,
          floor,
          url,
        });
        const sent = await processGenericAlert({
          trackedItemId: item.id,
          telegramChatId: item.chat.telegramChatId,
          eventType: 'LISTING',
          message,
          defaultCooldownMinutes: 2,
        });
        if (sent) alertedOrders.add(orderHash);
      }

      if (alertedOrders.size > 5000) alertedOrders.clear();
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Snipe worker: error processing item');
    }
  }
}
