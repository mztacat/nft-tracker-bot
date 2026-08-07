import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';
import { upsertUser } from '../middlewares/auth.middleware.js';

export function registerStartCommand(bot: Bot): void {
  bot.command('start', async (ctx) => {
    await upsertUser(ctx);

    const from = ctx.from!;
    const isOwner = String(from.id) === config.OWNER_ID;
    const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
    const isApproved = isOwner || (user?.isApproved ?? false);
    const name = from.first_name ?? from.username ?? 'there';

    if (!isApproved) {
      await ctx.reply(
        `👋 Hi <b>${name}</b>!\n\n` +
        `Welcome to <b>NFT Tracker Bot</b> — your personal NFT tracking and alert assistant.\n\n` +
        `⛔ You don't have access yet.\n\n` +
        `Tap the button below to request access from the administrator.`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '📩 Request Access', callback_data: 'do_request_access' }]],
          },
        }
      );
      return;
    }

    await ctx.reply(
      `👋 Hi <b>${name}</b>!\n\n` +
      `Welcome to <b>NFT Tracker Bot</b>.\n\n` +
      `I track NFT collections and assets and send you alerts when things happen.\n\n` +
      `Use /menu to open the main menu, or /help to see all commands.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '📋 Open Menu', callback_data: 'main_menu' }]],
        },
      }
    );
  });
}
