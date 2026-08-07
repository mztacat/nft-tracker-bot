import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { requireApproved } from '../middlewares/auth.middleware.js';

const ETH_ADDR = /^0x[0-9a-fA-F]{40}$/;

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function registerWalletCommand(bot: Bot): void {
  // /trackwallet <address> [label]
  bot.command('trackwallet', requireApproved, async (ctx) => {
    const parts = (ctx.match as string).trim().split(/\s+/).filter(Boolean);
    const address = parts[0];
    const label = parts.slice(1).join(' ') || null;

    if (!address || !ETH_ADDR.test(address)) {
      await ctx.reply(
        '👛 <b>Track a Wallet</b>\n\nUsage: <code>/trackwallet 0x… [label]</code>\n\nYou will get alerts whenever this wallet buys, mints, or sells NFTs.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    const dbUser = await prisma.user.findUnique({ where: { telegramId: String(ctx.from!.id) } });
    if (!dbChat || !dbUser) {
      await ctx.reply('⚠️ Please run /start first.');
      return;
    }

    const limit = parseInt(process.env.MAX_TRACKED_WALLETS ?? '5');
    const count = await prisma.trackedItem.count({
      where: { chatId: dbChat.id, type: 'WALLET', isActive: true },
    });
    if (count >= limit) {
      await ctx.reply(`⚠️ Maximum wallet tracking limit (${limit}) reached. Remove one with /wallets first.`);
      return;
    }

    const wallet = address.toLowerCase();
    const existing = await prisma.trackedItem.findFirst({
      where: { chatId: dbChat.id, type: 'WALLET', walletAddress: wallet },
    });

    let itemId: number;
    if (existing) {
      await prisma.trackedItem.update({
        where: { id: existing.id },
        data: { isActive: true, isPaused: false, label: label ?? existing.label },
      });
      itemId = existing.id;
    } else {
      const item = await prisma.trackedItem.create({
        data: {
          chatId: dbChat.id,
          ownerUserId: dbUser.id,
          type: 'WALLET',
          chain: 'ethereum',
          walletAddress: wallet,
          label,
          isActive: true,
        },
      });
      itemId = item.id;
    }

    // Ensure the WALLET_ACTIVITY notification setting exists and is enabled
    await prisma.notificationSetting.upsert({
      where: { trackedItemId_eventType: { trackedItemId: itemId, eventType: 'WALLET_ACTIVITY' } },
      create: {
        trackedItemId: itemId,
        chatId: dbChat.id,
        userId: dbUser.id,
        eventType: 'WALLET_ACTIVITY',
        enabled: true,
        cooldownMinutes: 1,
      },
      update: { enabled: true },
    });

    await ctx.reply(
      `✅ Tracking wallet <code>${shortAddr(wallet)}</code>${label ? ` (${label})` : ''}\n\nYou'll be alerted on NFT buys, mints, and sells.`,
      { parse_mode: 'HTML' }
    );
  });

  // /wallets — list tracked wallets with untrack buttons
  bot.command('wallets', requireApproved, async (ctx) => {
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    if (!dbChat) {
      await ctx.reply('No tracked wallets yet. Use /trackwallet to add one.');
      return;
    }

    const wallets = await prisma.trackedItem.findMany({
      where: { chatId: dbChat.id, type: 'WALLET', isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!wallets.length) {
      await ctx.reply('No tracked wallets yet. Use /trackwallet to add one.');
      return;
    }

    const keyboard = wallets.map((w) => [
      { text: `🗑 ${w.label ?? shortAddr(w.walletAddress!)}`, callback_data: `untrack_wallet:${w.id}` },
    ]);

    const lines = wallets.map(
      (w) => `• <code>${shortAddr(w.walletAddress!)}</code>${w.label ? ` — ${w.label}` : ''}`
    );

    await ctx.reply(`👛 <b>Tracked Wallets</b>\n\n${lines.join('\n')}\n\nTap to stop tracking:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // Untrack callback
  bot.callbackQuery(/^untrack_wallet:(\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match![1]);
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    if (!dbChat) return ctx.answerCallbackQuery('Chat not found');

    await prisma.trackedItem.updateMany({
      where: { id, chatId: dbChat.id, type: 'WALLET' },
      data: { isActive: false },
    });
    await ctx.answerCallbackQuery('Wallet untracked');
    await ctx.editMessageText('✅ Wallet removed from tracking.');
  });
}
