import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';

function buildMainMenuKeyboard(isAdmin: boolean) {
  const rows = [
    [{ text: '🔗 Add NFT Link', callback_data: 'menu_add_link' }],
    [{ text: '📋 My Tracked Items', callback_data: 'menu_tracking' }],
    [{ text: '👥 Holders', callback_data: 'menu_holders' }],
    [{ text: '🔔 Notifications', callback_data: 'menu_notifications' }],
    [{ text: '⚙️ Settings', callback_data: 'menu_settings' }],
    [{ text: '❓ Help', callback_data: 'menu_help' }],
  ];
  if (isAdmin) {
    rows.push([{ text: '🔑 Access Panel', callback_data: 'menu_access' }]);
  }
  return { inline_keyboard: rows };
}

export function registerMenuCommand(bot: Bot): void {
  bot.command('menu', async (ctx) => {
    const from = ctx.from!;
    const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
    const isAdmin = String(from.id) === config.OWNER_ID || (user?.isAdmin ?? false);

    await ctx.reply('<b>Main Menu</b>\n\nChoose an option:', {
      parse_mode: 'HTML',
      reply_markup: buildMainMenuKeyboard(isAdmin),
    });
  });
}

export { buildMainMenuKeyboard };
