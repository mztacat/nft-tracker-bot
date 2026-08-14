/**
 * Simple P&L calculator using FIFO cost-basis matching.
 * Works with the TransferRecord shape from transfers.ts.
 */

export interface PnlTransfer {
  type: 'buy' | 'sell' | 'mint' | 'transfer_in' | 'transfer_out';
  tokenId: string | null;
  price: number | null;
  timestamp: Date | null;
}

export interface PnlResult {
  /** Total ETH spent on buys and mints. */
  totalInvested: number;
  /** Total ETH received from sells. */
  totalReceived: number;
  /** Realized gain/loss: proceeds minus FIFO cost of sold items. */
  realizedGain: number;
  /** Number of items with known realized gain. */
  realizedCount: number;
  /** How many items are still held (buys - sells by count). */
  heldCount: number;
  /** Average cost of held items (FIFO remaining lots). */
  avgHeldCost: number | null;
  /** Unrealized gain vs current floor (null if no floor or no held items). */
  unrealizedGain: number | null;
  /** Items where cost basis was unknown. */
  unknownCostCount: number;
  /** Items where sell price was unknown. */
  unknownSellCount: number;
}

interface Lot {
  tokenId: string | null;
  cost: number;
}

export function computePnl(transfers: PnlTransfer[], currentFloor: number | null): PnlResult {
  // Sort chronologically
  const sorted = [...transfers].sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return a.timestamp.getTime() - b.timestamp.getTime();
  });

  let totalInvested = 0;
  let totalReceived = 0;
  let realizedGain = 0;
  let realizedCount = 0;
  let unknownCostCount = 0;
  let unknownSellCount = 0;

  // FIFO lots: queue of {tokenId, cost}
  const lots: Lot[] = [];

  for (const tx of sorted) {
    if (tx.type === 'buy' || tx.type === 'mint' || tx.type === 'transfer_in') {
      const cost = tx.price ?? 0;
      if (tx.price != null) totalInvested += cost;
      lots.push({ tokenId: tx.tokenId, cost });
    } else if (tx.type === 'sell' || tx.type === 'transfer_out') {
      // Find oldest lot matching this tokenId (FIFO)
      let lotIdx = -1;
      if (tx.tokenId) {
        lotIdx = lots.findIndex((l) => l.tokenId === tx.tokenId);
      }
      if (lotIdx === -1) {
        // No token-specific match — use oldest generic lot
        lotIdx = lots.length > 0 ? 0 : -1;
      }

      if (tx.type === 'sell') {
        if (tx.price != null) {
          totalReceived += tx.price;
          if (lotIdx !== -1) {
            realizedGain += tx.price - lots[lotIdx]!.cost;
            realizedCount++;
          } else {
            unknownCostCount++;
          }
        } else {
          unknownSellCount++;
        }
      }

      if (lotIdx !== -1) lots.splice(lotIdx, 1);
    }
  }

  const heldCount = lots.length;
  const heldWithCost = lots.filter((l) => l.cost > 0);
  const avgHeldCost = heldWithCost.length
    ? heldWithCost.reduce((s, l) => s + l.cost, 0) / heldWithCost.length
    : null;

  let unrealizedGain: number | null = null;
  if (currentFloor != null && heldCount > 0 && avgHeldCost != null) {
    unrealizedGain = (currentFloor - avgHeldCost) * heldCount;
  } else if (currentFloor != null && heldCount > 0) {
    unrealizedGain = currentFloor * heldCount;
  }

  return {
    totalInvested,
    totalReceived,
    realizedGain,
    realizedCount,
    heldCount,
    avgHeldCost,
    unrealizedGain,
    unknownCostCount,
    unknownSellCount,
  };
}
