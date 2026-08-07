import { Bot } from 'grammy';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { prisma } from '../../db/client.js';
import { getERC721Owner, getCollectionHolders } from '../../services/holders/holder.service.js';
import { formatERC721Owner, formatCollectionHolders } from '../../services/formatter/index.js';

export function registerHoldersCommand(bot: Bot): void {
  bot.command('holders', requireApproved, async (ctx) => {
    const chatIdStr = String(ctx.chat!.id);
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: chatIdStr } });
    if (!dbChat) {
      await ctx.reply('No tracked items yet. Use /link to add a collection or asset first.');
      return;
    }

    const items = await prisma.trackedItem.findMany({
      where: { chatId: dbChat.id, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (items.length === 0) {
      await ctx.reply('No tracked items yet. Use /link to add a collection or asset first.');
      return;
    }

    const keyboard = items.map((item) => [
      {
        text: `👁 ${item.label ?? item.collectionSlug ?? `#${item.tokenId}`}`,
        callback_data: item.type === 'COLLECTION'
          ? `view_holders_collection:${item.contractAddress}:${item.chain ?? 'ethereum'}`
          : `view_holder_erc721:${item.contractAddress}:${item.tokenId}:${item.chain ?? 'ethereum'}`,
      },
    ]);

    await ctx.reply('👥 <b>View Holders</b>\n\nSelect a tracked item to view holder info:', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });
}
