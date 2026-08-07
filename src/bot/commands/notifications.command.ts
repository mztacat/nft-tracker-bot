import { Bot } from 'grammy';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { prisma } from '../../db/client.js';

const COLLECTION_EVENTS = [
  'SALE', 'LISTING', 'DELISTING', 'OFFER', 'FLOOR_CHANGE',
  'VOLUME_SPIKE', 'SALES_SPIKE', 'HOLDER_COUNT_CHANGE', 'TOP_HOLDER_CHANGE',
  'WHALE_BUY', 'WHALE_SELL',
];

const ASSET_EVENTS = [
  'ASSET_LISTED', 'ASSET_DELISTED', 'ASSET_PRICE_CHANGE', 'ASSET_SOLD',
  'OWNER_CHANGE', 'TRANSFER', 'OFFER_RECEIVED',
];

function eventLabel(event: string): string {
  return event.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function registerNotificationsCommand(bot: Bot): void {
  bot.command('notifications', requireApproved, async (ctx) => {
    const chatIdStr = String(ctx.chat!.id);
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: chatIdStr } });
    if (!dbChat) {
      await ctx.reply('No tracked items yet.');
      return;
    }

    const items = await prisma.trackedItem.findMany({
      where: { chatId: dbChat.id, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (items.length === 0) {
      await ctx.reply('No tracked items. Use /link to add a collection or asset first.');
      return;
    }

    const keyboard = items.map((item) => [
      {
        text: `🔔 ${item.label ?? item.collectionSlug ?? `#${item.tokenId}` ?? 'Item'}`,
        callback_data: `notif_item:${item.id}`,
      },
    ]);

    await ctx.reply('🔔 <b>Notification Settings</b>\n\nSelect a tracked item to manage its notifications:', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });
}

export async function buildNotifSettingsKeyboard(trackedItemId: number, type: string) {
  const events = type === 'COLLECTION' ? COLLECTION_EVENTS : ASSET_EVENTS;
  const settings = await prisma.notificationSetting.findMany({
    where: { trackedItemId },
  });

  const settingsMap = new Map(settings.map((s) => [s.eventType, s]));

  const rows = events.map((event) => {
    const setting = settingsMap.get(event);
    const enabled = setting?.enabled ?? false;
    const icon = enabled ? '✅' : '❌';
    return [
      {
        text: `${icon} ${eventLabel(event)}`,
        callback_data: `toggle_notif:${trackedItemId}:${event}`,
      },
    ];
  });

  rows.push([{ text: '🔙 Back', callback_data: 'menu_notifications' }]);

  return { inline_keyboard: rows };
}

export { COLLECTION_EVENTS, ASSET_EVENTS, eventLabel };
