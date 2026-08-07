import { prisma } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config/index.js';
import { getLatestBlockNumber, getWalletNftTransfers } from '../services/providers/transfers.js';
import { processGenericAlert } from '../services/alerts/alert.engine.js';
import { formatWalletActivityAlert } from '../services/formatter/index.js';
import { getContractName } from '../services/providers/contractName.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const LOOKBACK_BLOCKS = 25;

const lastBlock = new Map<string, number>();
const seenTx = new Set<string>();

export async function runWalletWorker(): Promise<void> {
  if (!config.ALCHEMY_API_KEY) return;

  const items = await prisma.trackedItem.findMany({
    where: {
      isActive: true,
      isPaused: false,
      type: 'WALLET',
      walletAddress: { not: null },
    },
    include: { chat: true, notificationSettings: true },
  });
  if (!items.length) return;

  const latest = await getLatestBlockNumber();
  if (!latest) return;

  for (const item of items) {
    try {
      const wallet = item.walletAddress!.toLowerCase();
      const from = lastBlock.get(wallet) ?? latest - LOOKBACK_BLOCKS;
      const transfers = await getWalletNftTransfers(wallet, from, item.chain ?? 'ethereum');
      lastBlock.set(wallet, latest + 1);
      if (!transfers.length) continue;

      // Group new transfers by tx + contract + direction
      const groups = new Map<string, { direction: 'in' | 'out'; contract: string; tokenIds: string[]; txHash: string }>();
      for (const t of transfers) {
        const dedupeKey = `${t.txHash}:${t.tokenId}:${t.to}`;
        if (seenTx.has(dedupeKey)) continue;
        seenTx.add(dedupeKey);

        const direction: 'in' | 'out' = t.to?.toLowerCase() === wallet ? 'in' : 'out';
        // Ignore burns/self
        if (direction === 'out' && t.to === ZERO) continue;
        const gKey = `${t.txHash}:${t.contractAddress}:${direction}`;
        const g = groups.get(gKey) ?? { direction, contract: t.contractAddress, tokenIds: [], txHash: t.txHash };
        if (t.tokenId) g.tokenIds.push(t.tokenId);
        groups.set(gKey, g);
      }

      for (const g of groups.values()) {
        const realName = g.contract ? await getContractName(g.contract, item.chain ?? 'ethereum') : null;
        const message = formatWalletActivityAlert({
          wallet,
          label: item.label,
          direction: g.direction,
          collectionName:
            realName ?? (g.contract ? `${g.contract.slice(0, 6)}…${g.contract.slice(-4)}` : 'Unknown'),
          contractAddress: g.contract || null,
          tokenIds: g.tokenIds,
          txHash: g.txHash,
        });
        await processGenericAlert({
          trackedItemId: item.id,
          telegramChatId: item.chat.telegramChatId,
          eventType: 'WALLET_ACTIVITY',
          message,
          defaultCooldownMinutes: 1,
        });
      }

      // Keep the dedupe set bounded
      if (seenTx.size > 5000) seenTx.clear();
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Wallet worker: error processing item');
    }
  }
}
