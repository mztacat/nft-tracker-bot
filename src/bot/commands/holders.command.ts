import { Bot } from 'grammy';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { prisma } from '../../db/client.js';
import { replyAutoDelete } from '../../utils/auto-delete.js';

export function registerHoldersCommand(bot: Bot): void {
  bot.command('holders', requireApproved, async (ctx) => {
    const chatIdStr = String(ctx.chat!.id);
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: chatIdStr } });
    if (!dbChat) {
      await replyAutoDelete(ctx, 'No tracked items yet. Use /link to add a collection or asset first.');
      return;
    }

    const items = await prisma.trackedItem.findMany({
      where: { chatId: dbChat.id, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (items.length === 0) {
      await replyAutoDelete(ctx, 'No tracked items yet. Use /link to add a collection or asset first.');
      return;
    }

    const keyboard = items.map((item) => [
      {
        // col_holders:<addr> = ~54 chars max ✓   nft_owner:<addr>:<tokenId> = ~56 chars ✓
        text: `👁 ${item.label ?? item.collectionSlug ?? `#${item.tokenId}`}`,
        callback_data: item.type === 'COLLECTION'
          ? `col_holders:${item.contractAddress}`
          : `nft_owner:${item.contractAddress}:${item.tokenId}`,
      },
    ]);

    await replyAutoDelete(ctx, '👥 <b>View Holders</b>\n\nSelect a tracked item to view holder info:', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });
}
