import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { getWalletCollectionHistory } from '../../services/providers/transfers.js';
import { getOpenSeaCollection } from '../../services/providers/opensea.enhancer.js';
import { parseOpenSeaInput } from '../../utils/opensea-url.js';
import { replyAutoDelete } from '../../utils/auto-delete.js';
import { computePnl } from '../../services/pnl/pnl.service.js';
import { fmtEthUsd } from '../../utils/eth-price.js';

const ETH_ADDR = /^0x[0-9a-fA-F]{40}$/i;

const USAGE =
  '💰 <b>Wallet P&amp;L</b>\n\n' +
  'Usage: <code>/pnl &lt;wallet&gt; &lt;collection&gt;</code>\n\n' +
  'Examples:\n' +
  '• <code>/pnl 0x2fe4…7b58 fuego</code>\n' +
  '• <code>/pnl snoki fuego</code>  (if tracked with that label)\n\n' +
  'Shows realized gains/losses and unrealized value for a wallet in a collection.';

async function resolveWallet(arg: string, chatId: number): Promise<{ address: string; label: string | null } | null> {
  if (ETH_ADDR.test(arg)) return { address: arg.toLowerCase(), label: null };
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (!dbChat) return null;
  const item = await prisma.trackedItem.findFirst({
    where: { chatId: dbChat.id, type: 'WALLET', label: { equals: arg, mode: 'insensitive' }, isActive: true },
  });
  return item?.walletAddress ? { address: item.walletAddress, label: item.label } : null;
}

async function resolveContract(arg: string, chatId: number): Promise<{ contractAddress: string; collectionName: string; collectionSlug: string | null } | null> {
  const parsed = parseOpenSeaInput(arg);
  if (!parsed) return null;
  if (parsed.kind === 'address') return { contractAddress: parsed.value, collectionName: parsed.value, collectionSlug: null };

  const slug = parsed.value;
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (dbChat) {
    const item = await prisma.trackedItem.findFirst({
      where: {
        chatId: dbChat.id, type: 'COLLECTION', isActive: true,
        OR: [{ collectionSlug: slug }, { label: { equals: slug, mode: 'insensitive' } }],
      },
    });
    if (item?.contractAddress) return { contractAddress: item.contractAddress, collectionName: item.label ?? slug, collectionSlug: item.collectionSlug };
  }
  const info = await getOpenSeaCollection(slug);
  if (info?.contractAddress) return { contractAddress: info.contractAddress.toLowerCase(), collectionName: info.name, collectionSlug: slug };
  return null;
}

function shortAddr(addr: string) {
  return addr.length < 10 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function sign(n: number): string {
  return n >= 0 ? '+' : '';
}

export function registerPnlCommand(bot: Bot): void {
  bot.command('pnl', requireApproved, async (ctx) => {
    const parts = (ctx.match as string).trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const [walletArg, collectionArg] = parts;
    const chatId = ctx.chat!.id;

    const loadingMsg = await replyAutoDelete(ctx, '⏳ Computing P&L…');

    const [walletRes, contractRes] = await Promise.all([
      resolveWallet(walletArg!, chatId),
      resolveContract(collectionArg!, chatId),
    ]);

    const edit = (text: string) =>
      ctx.api.editMessageText(chatId, loadingMsg.message_id, text, { parse_mode: 'HTML' }).catch(() => {});

    if (!walletRes) {
      await edit(`❌ Could not resolve wallet: <code>${walletArg}</code>\n\nProvide a 0x address or a label from /trackwallet.`);
      return;
    }
    if (!contractRes) {
      await edit(`❌ Could not find collection: <b>${collectionArg}</b>\n\nProvide an OpenSea slug or contract address.`);
      return;
    }

    const txs = await getWalletCollectionHistory(walletRes.address, contractRes.contractAddress, 'ethereum', 500);

    if (!txs.length) {
      await edit(`💰 No NFT activity found for <code>${shortAddr(walletRes.address)}</code> in <b>${contractRes.collectionName}</b>.`);
      return;
    }

    // Get current floor from latest collection snapshot if tracked
    let currentFloor: number | null = null;
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
    if (dbChat) {
      const tracked = await prisma.trackedItem.findFirst({
        where: {
          chatId: dbChat.id, type: 'COLLECTION', isActive: true,
          OR: [
            { contractAddress: contractRes.contractAddress },
            ...(contractRes.collectionSlug ? [{ collectionSlug: contractRes.collectionSlug }] : []),
          ],
        },
      });
      if (tracked) {
        const snap = await prisma.collectionSnapshot.findFirst({
          where: { trackedItemId: tracked.id, floorPrice: { not: null } },
          orderBy: { timestamp: 'desc' },
        });
        currentFloor = snap?.floorPrice ?? null;
      }
    }

    // Map WalletCollectionTx → PnlTransfer
    const pnlTransfers = txs.map((t) => ({
      type: t.direction === 'buy' ? 'buy' as const
          : t.direction === 'sell' ? 'sell' as const
          : 'transfer_in' as const,
      tokenId: t.tokenId ?? null,
      price: t.ethValue > 0 ? t.ethValue : null,
      timestamp: t.timestamp ?? null,
    }));

    const pnl = computePnl(pnlTransfers, currentFloor);
    const buyCount = txs.filter(t => t.direction === 'buy').length;
    const sellCount = txs.filter(t => t.direction === 'sell').length;

    const walletDisplay = walletRes.label
      ? `${walletRes.label} (<code>${shortAddr(walletRes.address)}</code>)`
      : `<code>${shortAddr(walletRes.address)}</code>`;

    const realizedSign = sign(pnl.realizedGain);
    const unrealizedSign = pnl.unrealizedGain != null ? sign(pnl.unrealizedGain) : '';
    const netGain = pnl.realizedGain + (pnl.unrealizedGain ?? 0);
    const netSign = sign(netGain);

    const lines: (string | null)[] = [
      `💰 <b>P&amp;L — ${contractRes.collectionName}</b>`,
      ``,
      `Wallet  ${walletDisplay}`,
      ``,
      `<b>Activity</b>`,
      `Buys / Mints    <b>${buyCount}</b>`,
      `Sells            <b>${sellCount}</b>`,
      pnl.heldCount > 0 ? `Still held       <b>${pnl.heldCount} items</b>` : null,
      ``,
      `<b>Cash flow</b>`,
      pnl.totalInvested > 0 ? `Invested         ${fmtEthUsd(pnl.totalInvested, 4)}` : null,
      pnl.totalReceived > 0 ? `Received         ${fmtEthUsd(pnl.totalReceived, 4)}` : null,
      pnl.avgHeldCost != null ? `Avg cost held    ${fmtEthUsd(pnl.avgHeldCost, 4)}` : null,
      ``,
      `<b>P&amp;L</b>`,
      pnl.realizedCount > 0
        ? `Realized         <b>${realizedSign}${fmtEthUsd(pnl.realizedGain, 4)}</b> (${pnl.realizedCount} items)`
        : `Realized         —`,
      pnl.unrealizedGain != null && currentFloor != null
        ? `Unrealized       <b>${unrealizedSign}${fmtEthUsd(pnl.unrealizedGain, 4)}</b> <i>(vs floor ${fmtEthUsd(currentFloor, 4)})</i>`
        : pnl.heldCount > 0
        ? `Unrealized       <i>no floor data</i>`
        : null,
      (pnl.realizedCount > 0 || pnl.unrealizedGain != null)
        ? `Net              <b>${netSign}${fmtEthUsd(netGain, 4)}</b>`
        : null,
      ``,
      pnl.unknownCostCount > 0 ? `<i>⚠️ ${pnl.unknownCostCount} sell(s) had unknown cost basis</i>` : null,
      pnl.unknownSellCount > 0 ? `<i>⚠️ ${pnl.unknownSellCount} sell(s) had unknown price</i>` : null,
    ];

    await edit(lines.filter(l => l !== null).join('\n'));
  });
}
