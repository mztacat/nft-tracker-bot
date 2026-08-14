import { prisma } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config/index.js';
import { processGenericAlert } from '../services/alerts/alert.engine.js';
import { formatTraitListingAlert } from '../services/formatter/index.js';

/**
 * Trait-based listing alerts: notify when an NFT with a specific trait
 * (e.g. Tier = Legendary) is listed for sale. Requires OPENSEA_API_KEY.
 */

// slug -> last poll unix ts
const lastCheck = new Map<string, number>();
// order hashes / event ids already alerted
const seenOrders = new Set<string>();
// contract:tokenId -> traits (traits are immutable, cache forever)
const traitCache = new Map<string, Record<string, string>>();

async function osFetch(path: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.opensea.io/api/v2${path}`, {
      headers: { accept: 'application/json', 'x-api-key': config.OPENSEA_API_KEY! },
    });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, 'Trait worker: OpenSea non-OK');
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.error({ err, path }, 'Trait worker: OpenSea fetch error');
    return null;
  }
}

async function getTokenTraits(chain: string, contract: string, tokenId: string): Promise<Record<string, string>> {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  const hit = traitCache.get(key);
  if (hit) return hit;

  const data = await osFetch(`/chain/${chain}/contract/${contract}/nfts/${tokenId}`);
  const traits: Record<string, string> = {};
  for (const t of data?.nft?.traits ?? []) {
    if (t.trait_type != null && t.value != null) {
      traits[String(t.trait_type).toLowerCase()] = String(t.value).toLowerCase();
    }
  }
  traitCache.set(key, traits);
  if (traitCache.size > 20000) traitCache.clear();
  return traits;
}

export async function runTraitWorker(): Promise<void> {
  if (!config.OPENSEA_API_KEY) return;

  const items = await prisma.trackedItem.findMany({
    where: {
      isActive: true,
      isPaused: false,
      type: 'COLLECTION',
      collectionSlug: { not: null },
      notificationSettings: { some: { eventType: 'TRAIT_LISTING', enabled: true } },
    },
    include: { chat: true, notificationSettings: true },
  });
  if (!items.length) return;

  for (const item of items) {
    try {
      const slug = item.collectionSlug!;
      const chain = item.chain ?? 'ethereum';
      const setting = item.notificationSettings.find((s) => s.eventType === 'TRAIT_LISTING');
      const filter = setting?.thresholdJson as { traitType?: string; traitValue?: string } | null;
      if (!filter?.traitType || !filter?.traitValue) continue;

      const after = lastCheck.get(slug) ?? Math.floor(Date.now() / 1000) - 300;
      lastCheck.set(slug, Math.floor(Date.now() / 1000));

      const data = await osFetch(`/events/collection/${encodeURIComponent(slug)}?event_type=listing&after=${after}&limit=50`);
      const events: any[] = data?.asset_events ?? [];

      for (const ev of events) {
        const orderId: string = ev.order_hash ?? `${ev.event_timestamp}:${ev.nft?.identifier}`;
        if (seenOrders.has(orderId)) continue;

        const tokenId: string | undefined = ev.nft?.identifier ?? ev.asset?.identifier;
        const contract: string | undefined = ev.nft?.contract ?? ev.asset?.contract ?? item.contractAddress ?? undefined;
        if (!tokenId || !contract) continue;

        const traits = await getTokenTraits(chain, contract, tokenId);
        const actual = traits[filter.traitType.toLowerCase()];
        if (actual !== filter.traitValue.toLowerCase()) {
          seenOrders.add(orderId);
          continue;
        }

        // Price in ETH
        let price: number | null = null;
        const payment = ev.payment;
        if (payment?.quantity != null) {
          price = Number(payment.quantity) / 10 ** (payment.decimals ?? 18);
          if (!isFinite(price)) price = null;
        }

        const message = formatTraitListingAlert({
          collectionName: item.label ?? slug,
          traitType: filter.traitType,
          traitValue: filter.traitValue,
          tokenId,
          tokenName: ev.nft?.name ?? null,
          price,
          url: `https://opensea.io/assets/${chain}/${contract}/${tokenId}`,
        });
        const sent = await processGenericAlert({
          trackedItemId: item.id,
          telegramChatId: item.chat.telegramChatId,
          eventType: 'TRAIT_LISTING',
          message,
          defaultCooldownMinutes: 0,
        });
        if (sent !== false) seenOrders.add(orderId);
      }

      if (seenOrders.size > 10000) seenOrders.clear();
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Trait worker: error processing item');
    }
  }
}
