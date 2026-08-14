import { Bot, InlineKeyboard } from 'grammy';
import { prisma } from '../../db/client.js';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { getWalletCollectionHistory } from '../../services/providers/transfers.js';
import { getOpenSeaCollection } from '../../services/providers/opensea.enhancer.js';
import { formatWalletCollectionHistory } from '../../services/formatter/index.js';
import { parseOpenSeaInput } from '../../utils/opensea-url.js';
import { replyAutoDelete, scheduleDelete, isGroupChat } from '../../utils/auto-delete.js';

const ETH_ADDR = /^0x[0-9a-fA-F]{40}$/;
const PAGE_SIZE = 10;

const USAGE =
  '📜 <b>Wallet × Collection History</b>\n\n' +
  'Usage: <code>/history &lt;wallet&gt; &lt;collection&gt;</code>\n\n' +
  'Examples:\n' +
  '• <code>/history 0x2fe4…7b58 fuego</code>\n' +
  '• <code>/history snoki fuego</code>  (if wallet is tracked with that label)\n\n' +
  'Shows every buy &amp; sell for that wallet in the collection with price paid and date.';

async function resolveWallet(
  arg: string,
  chatId: number
): Promise<{ address: string; label: string | null } | null> {
  if (ETH_ADDR.test(arg)) return { address: arg.toLowerCase(), label: null };

  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (!dbChat) return null;
  const item = await prisma.trackedItem.findFirst({
    where: {
      chatId: dbChat.id,
      type: 'WALLET',
      label: { equals: arg, mode: 'insensitive' },
      isActive: true,
    },
  });
  if (item?.walletAddress) return { address: item.walletAddress, label: item.label };
  return null;
}

async function resolveContract(
  arg: string,
  chatId: number
): Promise<{ contractAddress: string; collectionName: string } | null> {
  const parsed = parseOpenSeaInput(arg);
  if (!parsed) return null;

  if (parsed.kind === 'address') return { contractAddress: parsed.value, collectionName: parsed.value };

  const slug = parsed.value;

  // Check tracked items first
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (dbChat) {
    const item = await prisma.trackedItem.findFirst({
      where: {
        chatId: dbChat.id,
        type: 'COLLECTION',
        isActive: true,
        OR: [
          { collectionSlug: slug },
          { label: { equals: arg, mode: 'insensitive' } },
        ],
      },
    });
    if (item?.contractAddress) {
      return { contractAddress: item.contractAddress, collectionName: item.label ?? slug };
    }
  }

  // Fall back to OpenSea
  const info = await getOpenSeaCollection(slug);
  if (info?.contractAddress) {
    return { contractAddress: info.contractAddress.toLowerCase(), collectionName: info.name };
  }
  return null;
}

export function registerHistoryCommand(bot: Bot): void {
  bot.command('history', requireApproved, async (ctx) => {
    const parts = (ctx.match as string).trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const [walletArg, collectionArg] = parts;
    const chatId = ctx.chat!.id;

    const walletMsg = await replyAutoDelete(ctx, '⏳ Resolving wallet and collection...');

    const [walletRes, contractRes] = await Promise.all([
      resolveWallet(walletArg!, chatId),
      resolveContract(collectionArg!, chatId),
    ]);

    if (!walletRes) {
      await ctx.api.editMessageText(
        chatId,
        walletMsg.message_id,
        `❌ Could not resolve wallet: <code>${walletArg}</code>\n\nProvide an 0x address or a label you used with /trackwallet.`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (!contractRes) {
      await ctx.api.editMessageText(
        chatId,
        walletMsg.message_id,
        `❌ Could not find collection: <b>${collectionArg}</b>\n\nProvide an OpenSea slug (e.g. <code>fuego</code>) or a contract address.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await ctx.api.editMessageText(
      chatId,
      walletMsg.message_id,
      '⏳ Fetching transaction history...'
    );

    const txs = await getWalletCollectionHistory(
      walletRes.address,
      contractRes.contractAddress,
      'ethereum',
      200
    );

    if (!txs.length) {
      await ctx.api.editMessageText(
        chatId,
        walletMsg.message_id,
        `📜 No NFT activity found for <code>${walletRes.address.slice(0, 6)}…${walletRes.address.slice(-4)}</code> in <b>${contractRes.collectionName}</b>.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const { text, hasMore } = formatWalletCollectionHistory({
      wallet: walletRes.address,
      walletLabel: walletRes.label,
      collectionName: contractRes.collectionName,
      txs,
      page: 0,
      pageSize: PAGE_SIZE,
    });

    const keyboard = hasMore
      ? new InlineKeyboard().text(
          `Show more (${txs.length - PAGE_SIZE} remaining)`,
          `history_page:${walletRes.address}:${contractRes.contractAddress}:${encodeURIComponent(contractRes.collectionName)}:1`
        )
      : undefined;

    await ctx.api.editMessageText(chatId, walletMsg.message_id, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  // Pagination callback
  bot.callbackQuery(/^history_page:(.+):(.+):(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, wallet, contract, encodedName, pageStr] = ctx.match!;
    const page = parseInt(pageStr!, 10);
    const collectionName = decodeURIComponent(encodedName!);

    const txs = await getWalletCollectionHistory(wallet!, contract!, 'ethereum', 200);

    const { text, hasMore } = formatWalletCollectionHistory({
      wallet: wallet!,
      walletLabel: null,
      collectionName,
      txs,
      page,
      pageSize: PAGE_SIZE,
    });

    const keyboard = hasMore
      ? new InlineKeyboard().text(
          `Show more (${Math.max(0, txs.length - (page + 1) * PAGE_SIZE)} remaining)`,
          `history_page:${wallet}:${contract}:${encodedName}:${page + 1}`
        )
      : undefined;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    // Reset the 2-min delete timer from each page flip in group chats
    if (isGroupChat(ctx) && ctx.chat?.id && ctx.callbackQuery.message?.message_id) {
      scheduleDelete(ctx.api as any, ctx.chat.id, ctx.callbackQuery.message.message_id);
    }
  });
}
