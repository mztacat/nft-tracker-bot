import type { NftTransfer } from '../providers/transfers.js';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

export interface WhaleThresholds {
  minItems: number; // sweep: one wallet acquires >= N items in window
  minEth: number;   // whale: one wallet spends >= Y ETH in window
}

export interface WhaleDetection {
  buyer: string;
  transfers: NftTransfer[];
  itemCount: number;
  txHashes: string[];
  ethSpent: number | null;
  isSweep: boolean;
}

/**
 * Filter transfers down to market-style acquisitions: exclude mints (from
 * zero address), burns (to zero address) and self-transfers.
 */
export function filterBuys(transfers: NftTransfer[]): NftTransfer[] {
  return transfers.filter(
    (t) => t.to && t.to !== ZERO_ADDR && t.from !== ZERO_ADDR && t.to !== t.from
  );
}

/**
 * Keep only transfers inside the detection window. Transfers without a block
 * timestamp are excluded — we can't prove they're recent, and alerting on
 * stale activity is worse than missing an edge case.
 */
export function filterWithinWindow(
  transfers: NftTransfer[],
  windowMinutes: number,
  now: Date = new Date()
): NftTransfer[] {
  const cutoff = now.getTime() - windowMinutes * 60_000;
  return transfers.filter((t) => t.timestamp != null && t.timestamp.getTime() >= cutoff);
}

/**
 * Compute the next block cursor after a poll. Pollers fetch from
 * `cursor + 1`, so the cursor is the last FULLY processed block.
 * - Complete fetch: safe to jump to the chain head.
 * - Incomplete fetch (RPC failure or pagination cap): pagination can bisect
 *   a block, so the highest received block may be only partially fetched.
 *   Resume from just BEFORE it (maxBlock - 1) so the boundary block is
 *   re-fetched in full next tick; callers must deduplicate the overlap by
 *   tx hash. If nothing was received, keep the previous cursor.
 */
export function nextCursor(params: {
  complete: boolean;
  latestBlock: number;
  transfers: NftTransfer[];
  prevCursor: number;
}): number {
  const { complete, latestBlock, transfers, prevCursor } = params;
  if (complete) return latestBlock;
  if (transfers.length === 0) return prevCursor;
  const maxBlock = Math.max(...transfers.map((t) => t.blockNum));
  return Math.max(prevCursor, maxBlock - 1);
}

/**
 * Drop transfers whose tx hash was already processed (recorded as a market
 * event). Needed because incomplete fetches re-scan the boundary block.
 */
export function excludeSeenTxs(transfers: NftTransfer[], seenTxHashes: Set<string>): NftTransfer[] {
  return transfers.filter((t) => !seenTxHashes.has(t.txHash));
}

/** Group acquisitions by buyer wallet. */
export function groupByBuyer(buys: NftTransfer[]): Map<string, NftTransfer[]> {
  const byBuyer = new Map<string, NftTransfer[]>();
  for (const t of buys) {
    const list = byBuyer.get(t.to) ?? [];
    list.push(t);
    byBuyer.set(t.to, list);
  }
  return byBuyer;
}

/**
 * Decide which buyer groups qualify as whale buys / sweeps.
 *
 * `txEthValues` maps txHash -> ETH value; ethSpent is the sum over the
 * buyer's unique txs. Groups with zero spend that only barely clear the item
 * threshold are treated as airdrops/wallet shuffles and excluded — unless the
 * count is >= 2x the threshold (spend data can be missing for aggregators).
 */
export function detectWhaleBuys(
  transfers: NftTransfer[],
  thresholds: WhaleThresholds,
  txEthValues: Map<string, number>
): WhaleDetection[] {
  const detections: WhaleDetection[] = [];
  const byBuyer = groupByBuyer(filterBuys(transfers));

  for (const [buyer, buyerTransfers] of byBuyer) {
    const itemCount = buyerTransfers.reduce((s, t) => s + t.amount, 0);
    const txHashes = [...new Set(buyerTransfers.map((t) => t.txHash))];
    const ethSpent = txHashes.reduce((s, h) => s + (txEthValues.get(h) ?? 0), 0);

    const isSweep = itemCount >= thresholds.minItems;
    const isWhaleSpend = ethSpent >= thresholds.minEth;
    if (!isSweep && !isWhaleSpend) continue;

    // Airdrop / transfer guard
    if (isSweep && !isWhaleSpend && ethSpent === 0 && itemCount < thresholds.minItems * 2) {
      continue;
    }

    detections.push({ buyer, transfers: buyerTransfers, itemCount, txHashes, ethSpent, isSweep });
  }

  return detections;
}
