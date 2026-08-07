import { prisma } from '../db/client.js';
import { logger } from '../logger.js';
import { getProvider } from '../services/providers/index.js';
import {
  getLatestBlockNumber,
  getNftTransfersSince,
  getTxEthValues,
} from '../services/providers/transfers.js';
import { processWhaleBuyAlert } from '../services/alerts/alert.engine.js';
import {
  detectWhaleBuys,
  excludeSeenTransfers,
  filterBuys,
  filterWithinWindow,
  groupByBuyer,
  nextCursor,
} from '../services/whale/whale.detector.js';

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

// Process-level non-overlap lock: node-cron allows overlapping executions,
// and two concurrent ticks would read the same cursors and double-alert.
let _running = false;

export async function runWhaleWorker(): Promise<void> {
  if (_running) {
    logger.warn('Whale worker tick skipped: previous tick still running');
    return;
  }
  _running = true;
  try {
    await runWhaleWorkerInner();
  } finally {
    _running = false;
  }
}

async function runWhaleWorkerInner(): Promise<void> {
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

      const { transfers, complete } = await getNftTransfersSince(contractAddress, fromBlock + 1, chain);

      // Only advance the cursor as far as we actually fetched — an RPC
      // failure or pagination cap must not permanently skip transfers
      const newCursor = nextCursor({ complete, latestBlock, transfers, prevCursor: fromBlock });
      if (newCursor !== fromBlock) await setCursor(item.id, newCursor);
      if (!complete) {
        logger.warn(
          { itemId: item.id, fetched: transfers.length, newCursor },
          'Whale worker: incomplete transfer fetch, will resume next tick'
        );
      }
      if (transfers.length === 0) continue;

      // Enforce the detection window: never alert on stale activity pulled
      // in by a large catch-up scan after downtime
      const recent = filterWithinWindow(transfers, WINDOW_MINUTES);
      if (recent.length === 0) continue;

      // Incomplete fetches re-scan the boundary block; drop transfers this
      // item already processed. Dedupe is scoped PER tracked item (assetId
      // marker) so other chats tracking the same collection still alert, and
      // keyed by per-transfer uniqueId, never tx hash alone (a sweep tx
      // emits many transfers and pagination can split them mid-tx).
      const candidateHashes = [...new Set(recent.map((t) => t.txHash))];
      const seenEvents = await prisma.marketEvent.findMany({
        where: {
          assetId: `item:${item.id}`,
          eventType: 'WHALE_BUY',
          txHash: { in: candidateHashes },
        },
        select: { rawJson: true },
      });
      const seen = new Set<string>(
        seenEvents
          .map((e) => (e.rawJson as any)?.uniqueId)
          .filter((u): u is string => typeof u === 'string')
      );
      const fresh = excludeSeenTransfers(recent, seen);
      if (fresh.length === 0) continue;

      const buys = filterBuys(fresh);
      if (buys.length === 0) continue;

      const whaleNotif = item.notificationSettings.find(
        (s) => s.eventType === 'WHALE_BUY' && s.enabled
      );
      const rawThresholds = (whaleNotif?.thresholdJson as any) ?? {};
      const thresholds = {
        minItems: rawThresholds.minItems ?? DEFAULT_MIN_ITEMS,
        minEth: rawThresholds.minEth ?? DEFAULT_MIN_ETH,
      };

      // Fetch tx ETH values only for candidate groups (count near threshold
      // or few txs) to avoid RPC waste on airdrop fan-outs
      const candidateTxHashes: string[] = [];
      for (const [, buyerTransfers] of groupByBuyer(buys)) {
        const itemCount = buyerTransfers.reduce((s, t) => s + t.amount, 0);
        const txHashes = [...new Set(buyerTransfers.map((t) => t.txHash))];
        if (itemCount >= thresholds.minItems || txHashes.length <= 5) {
          candidateTxHashes.push(...txHashes);
        }
      }
      const txEthValues = await getTxEthValues(candidateTxHashes, chain);

      const detections = detectWhaleBuys(buys, thresholds, txEthValues);

      for (const det of detections) {
        const { buyer, itemCount, txHashes, ethSpent, isSweep, transfers: buyerTransfers } = det;

        // Record market events for downstream digests/analytics
        await prisma.marketEvent.createMany({
          data: buyerTransfers.map((t) => ({
            collectionId: contractAddress,
            assetId: `item:${item.id}`, // per-item dedupe scope
            eventType: 'WHALE_BUY',
            buyer,
            seller: t.from,
            txHash: t.txHash,
            timestamp: t.timestamp ?? new Date(),
            rawJson: { uniqueId: t.uniqueId, tokenId: t.tokenId, amount: t.amount, blockNum: t.blockNum },
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
          isSweep,
        });
      }
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Whale worker: error processing item');
    }
  }

  logger.info({ count: items.length }, 'Whale worker tick complete');
}
