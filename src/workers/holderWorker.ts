import { prisma } from '../db/client.js';
import { Prisma } from '@prisma/client';
import { getProvider } from '../services/providers/index.js';
import { processGenericAlert } from '../services/alerts/alert.engine.js';
import { logger } from '../logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Defaults; overridable per item via NotificationSetting.thresholdJson
const DEFAULT_HOLDER_CHANGE_PCT = 2; // >2% unique-holder change in 24h
const DEFAULT_TOP_HOLDER_DROP_PCT = 10; // top-10 holder reduced position by >=10%

type TopHolderEntry = { address: string; balance: number; percentage?: number };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Find the snapshot closest to 24h ago (must be at least ~20h old so early
 * ticks don't compare against 30-minute-old data and call it a "24h" change).
 */
async function findBaselineSnapshot(trackedItemId: number, now: Date) {
  const minAge = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  return prisma.collectionSnapshot.findFirst({
    where: {
      trackedItemId,
      timestamp: { lte: minAge, gte: new Date(now.getTime() - 2 * DAY_MS) },
      holdersCount: { not: null },
    },
    orderBy: { timestamp: 'desc' },
  });
}

// Process-level non-overlap lock: node-cron allows overlapping executions,
// and a tick can outlast the schedule interval when many items are tracked.
let _running = false;

export async function runHolderWorker(): Promise<void> {
  if (_running) {
    logger.warn('Holder worker: previous tick still running, skipping');
    return;
  }
  _running = true;
  try {
    await runHolderWorkerInner();
  } finally {
    _running = false;
  }
}

async function runHolderWorkerInner(): Promise<void> {
  logger.info('Holder worker tick started');

  const items = await prisma.trackedItem.findMany({
    where: { isActive: true, isPaused: false, type: 'COLLECTION', contractAddress: { not: null } },
    include: { chat: true, notificationSettings: true },
  });

  const provider = getProvider();

  for (const item of items) {
    try {
      const data = await provider.getCollectionHolders(item.contractAddress!, item.chain ?? 'ethereum');
      if (!data?.uniqueHolders) continue;

      const now = new Date();
      const name = esc(item.label ?? item.collectionSlug ?? item.contractAddress!);

      // Previous snapshot (any age) for top-holder comparison
      const prev = await prisma.collectionSnapshot.findFirst({
        where: { trackedItemId: item.id, topHoldersJson: { not: Prisma.DbNull } },
        orderBy: { timestamp: 'desc' },
      });

      // ~24h-old baseline for holder-count change
      const baseline = await findBaselineSnapshot(item.id, now);

      // Always snapshot current holder state (top-10 balances + count)
      await prisma.collectionSnapshot.create({
        data: {
          trackedItemId: item.id,
          holdersCount: data.uniqueHolders,
          topHoldersJson: (data.topHolders ?? []).slice(0, 10).map((h) => ({
            address: h.address,
            balance: h.balance,
            percentage: h.percentage ?? null,
          })),
        },
      });

      // ── Alert 1: unique-holder count change over ~24h ──────────────────
      const countNotif = item.notificationSettings.find(
        (s) => s.eventType === 'HOLDER_COUNT_CHANGE' && s.enabled
      );
      if (countNotif && baseline?.holdersCount) {
        const change = data.uniqueHolders - baseline.holdersCount;
        const changePct = (change / baseline.holdersCount) * 100;
        const threshold = (countNotif.thresholdJson as any)?.pct ?? DEFAULT_HOLDER_CHANGE_PCT;

        if (Math.abs(changePct) >= threshold) {
          const dir = change < 0 ? '📉 Holders exiting' : '📈 Holders growing';
          const message =
            `👥 <b>Holder Count Change</b> — ${dir}\n\n` +
            `Collection: <b>${name}</b>\n` +
            `Holders: <b>${data.uniqueHolders.toLocaleString()}</b>\n` +
            `24h ago: ${baseline.holdersCount.toLocaleString()}\n` +
            `Change: ${change > 0 ? '+' : ''}${change.toLocaleString()} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)` +
            (change < 0 ? `\n\n⚠️ A shrinking holder base can signal distribution risk.` : '');

          await processGenericAlert({
            trackedItemId: item.id,
            telegramChatId: item.chat.telegramChatId,
            eventType: 'HOLDER_COUNT_CHANGE',
            message,
            defaultCooldownMinutes: 360,
          });
        }
      }

      // ── Alert 2: top-10 holder reduced position or exited top-10 ───────
      const topNotif = item.notificationSettings.find(
        (s) => s.eventType === 'TOP_HOLDER_CHANGE' && s.enabled
      );
      const prevTop = (prev?.topHoldersJson as TopHolderEntry[] | null) ?? null;
      if (topNotif && prevTop?.length && data.topHolders?.length) {
        const dropPct = (topNotif.thresholdJson as any)?.dropPct ?? DEFAULT_TOP_HOLDER_DROP_PCT;
        const currentByAddr = new Map(
          data.topHolders.map((h) => [h.address.toLowerCase(), h.balance])
        );

        const exits: string[] = [];
        for (const ph of prevTop) {
          if (!ph?.address || !(ph.balance > 0)) continue;
          const cur = currentByAddr.get(ph.address.toLowerCase());
          if (cur == null) {
            // No longer in top-10 — sold down or transferred out
            exits.push(`• <code>${esc(shortAddr(ph.address))}</code> left the top 10 (held ${ph.balance})`);
          } else if (cur < ph.balance) {
            const reducedPct = ((ph.balance - cur) / ph.balance) * 100;
            if (reducedPct >= dropPct) {
              exits.push(
                `• <code>${esc(shortAddr(ph.address))}</code> cut position ${ph.balance} → ${cur} (−${reducedPct.toFixed(0)}%)`
              );
            }
          }
        }

        if (exits.length > 0) {
          const message =
            `🚪 <b>Top Holder Exit Alert</b>\n\n` +
            `Collection: <b>${name}</b>\n\n` +
            exits.slice(0, 5).join('\n') +
            (exits.length > 5 ? `\n…and ${exits.length - 5} more` : '') +
            `\n\n⚠️ Top holders reducing positions is an early distribution-risk signal.`;

          await processGenericAlert({
            trackedItemId: item.id,
            telegramChatId: item.chat.telegramChatId,
            eventType: 'TOP_HOLDER_CHANGE',
            message,
            defaultCooldownMinutes: 60,
          });
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      logger.error({ err, itemId: item.id }, 'Holder worker: error processing item');
    }
  }

  logger.info('Holder worker tick complete');
}
