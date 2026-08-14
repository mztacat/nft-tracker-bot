import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';

function buildMainMenuKeyboard(isAdmin: boolean) {
  const rows = [
    [
      { text: '🔗 Add Collection', callback_data: 'menu_add_link' },
      { text: '📋 Tracked', callback_data: 'menu_tracking' },
    ],
    [
      { text: '👛 Wallets', callback_data: 'menu_wallets' },
      { text: '💼 Portfolio', callback_data: 'menu_portfolio' },
    ],
    [
      { text: '🏷 Trait Alerts', callback_data: 'menu_traits' },
      { text: '🚀 Deployer Watch', callback_data: 'menu_deployer' },
    ],
    [
      { text: '👥 Holders', callback_data: 'menu_holders' },
      { text: '🔔 Notifications', callback_data: 'menu_notifications' },
    ],
    [
      { text: '⚙️ Settings', callback_data: 'menu_settings' },
      { text: '❓ Help', callback_data: 'menu_help' },
    ],
  ];
  if (isAdmin) {
    rows.push([{ text: '🔑 Access Panel', callback_data: 'menu_access' }]);
  }
  return { inline_keyboard: rows };
}

export async function buildMenuText(telegramChatId: string): Promise<string> {
  let collections = 0;
  let wallets = 0;
  try {
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
    if (dbChat) {
      [collections, wallets] = await Promise.all([
        prisma.trackedItem.count({ where: { chatId: dbChat.id, type: 'COLLECTION', isActive: true } }),
        prisma.trackedItem.count({ where: { chatId: dbChat.id, type: 'WALLET', isActive: true } }),
      ]);
    }
  } catch {}

  return [
    `<b>NFT Lookinto</b>`,
    `<i>Floors · Whales · Wallets · Snipes</i>`,
    ``,
    `Watching  <b>${collections}</b> collection${collections === 1 ? '' : 's'}  ·  <b>${wallets}</b> wallet${wallets === 1 ? '' : 's'}`,
    ``,
    `Paste any OpenSea link to look up a collection or NFT instantly.`,
  ].join('\n');
}

export function registerMenuCommand(bot: Bot): void {
  bot.command('menu', async (ctx) => {
    const from = ctx.from!;
    const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
    const isAdmin = String(from.id) === config.OWNER_ID || (user?.isAdmin ?? false);

    await ctx.reply(await buildMenuText(String(ctx.chat!.id)), {
      parse_mode: 'HTML',
      reply_markup: buildMainMenuKeyboard(isAdmin),
    });
  });
}

export { buildMainMenuKeyboard };
