import { prisma } from '../db/client.js';
import { logger } from '../logger.js';
import { getProvider } from '../services/providers/index.js';
import {
  getLatestBlockNumber,
  getNftTransfersSince,
  getTxEthValues,
} from '../services/providers/transfers.js';
import { processWhaleBuyAlert } from '../services/alerts/alert.engine.js';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const CURSOR_SCOPE = 'whale_cursor';
const FIRST_RUN_LOOKBACK_BLOCKS = 50; // ~10 minutes on Ethereum
const MAX_LOOKBACK_BLOCKS = 2000;     // don't scan huge ranges after downtime
const WINDOW_MINUTES = 10;

// Default thresholds; can be overridden per item via NotificationSetting.thresholdJson
const DEFAULT_MIN_ITEMS = 3; // sweep: one wallet buys >= N items in window
const DEFAULT_MIN_ETH = 5;   // whale: one wallet spends >= Y ETH in window

async function getCursor(itemId: number): Promise<number | null> {
  const row = await prisma.settings.findUnique({
    where: { scope_scopeId_key: { scope: CURSOR_SCOPE, scopeId: String(itemId), key: 'lastBlock' } },
  });
  return row ? Number(row.value) : null;
}

async function setCursor(itemId: number, block: number): Promise<void> {
  await prisma.settings.upsert({
    where: { scope_scopeId_key: { scope: CURSOR_SCOPE, scopeId: String(itemId), key: 'lastBlock' } },
    create: { scope: CURSOR_SCOPE, scopeId: String(itemId), key: 'lastBlock', value: String(block) },
    update: { value: String(block) },
  });
}

export async function runWhaleWorker(): Promise<void> {
  logger.info('Whale worker tick started');

  const items = await prisma.trackedItem.findMany({
    where: {
      isActive: true,
      isPaused: false,
      type: 'COLLECTION',
      notificationSettings: { some: { eventType: 'WHALE_BUY', enabled: true } },
    },
    include: { chat: true, notificationSettings: true },
  });

  if (items.length === 0) {
    logger.debug('Whale worker: no items with WHALE_BUY enabled');
    return;
  }

  for (const item of items) {
    try {
      const chain = item.chain ?? 'ethereum';

      // Resolve contract address if missing, persist for future ticks
      let contractAddress = item.contractAddress;
      if (!contractAddress && item.collectionSlug) {
        const data = await getProvider().getCollectionData(item.collectionSlug, chain);
        if (data?.contractAddress) {
          contractAddress = data.contractAddress;
          await prisma.trackedItem.update({
            where: { id: item.id },
            data: { contractAddress },
          });
        }
      }
      if (!contractAddress) {
        logger.warn({ itemId: item.id }, 'Whale worker: no contract address, skipping');
        continue;
      }

      const latestBlock = await getLatestBlockNumber(chain);
      if (!latestBlock) continue;

      let fromBlock = await getCursor(item.id);
      if (fromBlock == null) {
        fromBlock = latestBlock - FIRST_RUN_LOOKBACK_BLOCKS;
      } else if (latestBlock - fromBlock > MAX_LOOKBACK_BLOCKS) {
        fromBlock = latestBlock - MAX_LOOKBACK_BLOCKS;
      }

      const transfers = await getNftTransfersSince(contractAddress, fromBlock + 1, chain);
      await setCursor(item.id, latestBlock);
      if (transfers.length === 0) continue;

      // Only market-style acquisitions: exclude mints and burns
      const buys = transfers.filter(
        (t) => t.to && t.to !== ZERO_ADDR && t.from !== ZERO_ADDR && t.to !== t.from
      );
      if (buys.length === 0) continue;

      // Group by buyer wallet
      const byBuyer = new Map<string, typeof buys>();
      for (const t of buys) {
        const list = byBuyer.get(t.to) ?? [];
        list.push(t);
        byBuyer.set(t.to, list);
      }

      const whaleNotif = item.notificationSettings.find(
        (s) => s.eventType === 'WHALE_BUY' && s.enabled
      );
      const thresholds = (whaleNotif?.thresholdJson as any) ?? {};
      const minItems = thresholds.minItems ?? DEFAULT_MIN_ITEMS;
      const minEth = thresholds.minEth ?? DEFAULT_MIN_ETH;

      for (const [buyer, buyerTransfers] of byBuyer) {
        const itemCount = buyerTransfers.reduce((s, t) => s + t.amount, 0);
        const txHashes = [...new Set(buyerTransfers.map((t) => t.txHash))];

        // Candidate check: only fetch tx values when the item count is close
        // to threshold or there are few txs (avoid RPC waste on airdrops)
        let ethSpent: number | null = null;
        const isSweepCandidate = itemCount >= minItems;
        if (isSweepCandidate || txHashes.length <= 5) {
          const values = await getTxEthValues(txHashes, chain);
          ethSpent = [...values.values()].reduce((s, v) => s + v, 0);
        }

        const isWhaleSpend = ethSpent != null && ethSpent >= minEth;
        if (!isSweepCandidate && !isWhaleSpend) continue;

        // Airdrop/transfer guard: sweep alerts require actual spend unless
        // spend data is unavailable and the count is well above threshold
        if (isSweepCandidate && !isWhaleSpend && (ethSpent ?? 0) === 0 && itemCount < minItems * 2) {
          logger.debug({ buyer, itemCount }, 'Whale worker: zero-spend group skipped (likely transfer/airdrop)');
          continue;
        }

        // Record market events for downstream digests/analytics
        await prisma.marketEvent.createMany({
          data: buyerTransfers.map((t) => ({
            collectionId: contractAddress,
            eventType: 'WHALE_BUY',
            buyer,
            seller: t.from,
            txHash: t.txHash,
            timestamp: t.timestamp ?? new Date(),
            rawJson: { tokenId: t.tokenId, amount: t.amount, blockNum: t.blockNum },
          })),
        });

        await processWhaleBuyAlert({
          trackedItemId: item.id,
          telegramChatId: item.chat.telegramChatId,
          collectionName: item.label ?? item.collectionSlug ?? contractAddress,
          buyer,
          itemCount,
          ethSpent,
          txCount: txHashes.length,
          windowMinutes: WINDOW_MINUTES,
          isSweep: isSweepCandidate,
        });
      }
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Whale worker: error processing item');
    }
  }

  logger.info({ count: items.length }, 'Whale worker tick complete');
}
