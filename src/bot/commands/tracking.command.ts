import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { replyAutoDelete } from '../../utils/auto-delete.js';

export function registerTrackingCommand(bot: Bot): void {
  bot.command('tracking', requireApproved, async (ctx) => {
    const chatIdStr = String(ctx.chat!.id);
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: chatIdStr } });
    if (!dbChat) {
      await replyAutoDelete(ctx, 'No tracked items yet.');
      return;
    }

    const items = await prisma.trackedItem.findMany({
      where: { chatId: dbChat.id, isActive: true },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });

    if (items.length === 0) {
      await replyAutoDelete(ctx,
        '📋 <b>My Tracked Items</b>\n\nYou have no tracked items yet.\n\nUse /link to add an NFT or collection.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const collections = items.filter((i) => i.type === 'COLLECTION');
    const assets = items.filter((i) => i.type === 'ASSET');
    const wallets = items.filter((i) => i.type === 'WALLET');

    let text = '📋 <b>My Tracked Items</b>\n';

    if (collections.length > 0) {
      text += `\n<b>Collections (${collections.length})</b>\n`;
      collections.forEach((item, i) => {
        const statusIcon = item.isPaused ? '⏸' : '🟢';
        text += `${statusIcon} ${i + 1}. <b>${item.label ?? item.collectionSlug ?? 'Unknown'}</b>`;
        if (item.chain) text += ` <i>(${item.chain})</i>`;
        text += '\n';
      });
    }

    if (assets.length > 0) {
      text += `\n<b>Assets (${assets.length})</b>\n`;
      assets.forEach((item, i) => {
        const statusIcon = item.isPaused ? '⏸' : '🟢';
        text += `${statusIcon} ${i + 1}. <b>${item.label ?? `#${item.tokenId}`}</b>`;
        if (item.collectionSlug) text += ` — ${item.collectionSlug}`;
        text += '\n';
      });
    }

    if (wallets.length > 0) {
      text += `\n<b>Wallets (${wallets.length})</b>\n`;
      wallets.forEach((item, i) => {
        const statusIcon = item.isPaused ? '⏸' : '🟢';
        text += `${statusIcon} ${i + 1}. <code>${item.walletAddress?.slice(0, 10)}…</code>\n`;
      });
    }

    const keyboard = items.slice(0, 10).map((item) => [
      {
        text: `🗑 Untrack ${item.label ?? item.collectionSlug ?? `#${item.tokenId}`}`,
        callback_data: `untrack:${item.id}`,
      },
    ]);
    keyboard.push([{ text: '🔙 Back', callback_data: 'main_menu' }]);

    await replyAutoDelete(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });
}
