import { prisma } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config/index.js';
import { getLatestBlockNumber } from '../services/providers/transfers.js';
import { getNewDeployments } from '../services/providers/deployer.js';
import { processGenericAlert } from '../services/alerts/alert.engine.js';
import { formatDeployerAlert } from '../services/formatter/index.js';

const LOOKBACK_BLOCKS = 25;
const lastBlock = new Map<string, number>();
const seenContracts = new Set<string>();

export async function runDeployerWorker(): Promise<void> {
  if (!config.ALCHEMY_API_KEY) return;

  const items = await prisma.trackedItem.findMany({
    where: {
      isActive: true,
      isPaused: false,
      type: 'WALLET',
      walletAddress: { not: null },
      notificationSettings: { some: { eventType: 'DEPLOYER_ACTIVITY', enabled: true } },
    },
    include: { chat: true },
  });
  if (!items.length) return;

  const latest = await getLatestBlockNumber();
  if (!latest) return;

  for (const item of items) {
    try {
      const deployer = item.walletAddress!.toLowerCase();
      const chain = item.chain ?? 'ethereum';
      const from = lastBlock.get(deployer) ?? latest - LOOKBACK_BLOCKS;
      const deployments = await getNewDeployments(deployer, from, chain);
      lastBlock.set(deployer, latest + 1);

      for (const d of deployments) {
        if (seenContracts.has(d.contractAddress)) continue;

        const message = formatDeployerAlert({
          deployer,
          label: item.label,
          contractAddress: d.contractAddress,
          kind: d.kind,
          name: d.name,
          symbol: d.symbol,
          txHash: d.txHash,
        });
        const sent = await processGenericAlert({
          trackedItemId: item.id,
          telegramChatId: item.chat.telegramChatId,
          eventType: 'DEPLOYER_ACTIVITY',
          message,
          defaultCooldownMinutes: 0,
        });
        if (sent) seenContracts.add(d.contractAddress);
      }

      if (seenContracts.size > 2000) seenContracts.clear();
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Deployer worker: error processing item');
    }
  }
}
