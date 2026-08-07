import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';
import { requireAdmin } from '../middlewares/auth.middleware.js';
import { trackCollection, untrackCollection, getCollectionSummary } from '../../services/nft/collection.service.js';
import { trackAsset, untrackAsset } from '../../services/nft/asset.service.js';
import { getERC721Owner, getCollectionHolders } from '../../services/holders/holder.service.js';
import {
  formatERC721Owner,
  formatCollectionHolders,
} from '../../services/formatter/index.js';
import { buildMainMenuKeyboard } from '../commands/menu.command.js';
import { buildNotifSettingsKeyboard } from '../commands/notifications.command.js';
import { logger } from '../../logger.js';

export function registerCallbackHandlers(bot: Bot): void {
  bot.callbackQuery('cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery('main_menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    const from = ctx.from!;
    const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
    const isAdmin = String(from.id) === config.OWNER_ID || (user?.isAdmin ?? false);
    await ctx.editMessageText('<b>Main Menu</b>\n\nChoose an option:', {
      parse_mode: 'HTML',
      reply_markup: buildMainMenuKeyboard(isAdmin),
    });
  });

  bot.callbackQuery('menu_help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('Use /help to see all commands.');
  });

  bot.callbackQuery('menu_settings', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('⚙️ Settings coming soon.');
  });

  // Track collection
  bot.callbackQuery(/^track_collection:(.+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Tracking...');
    const [, slug, chain] = ctx.match!;
    const from = ctx.from!;
    try {
      // Resolve contract address (cached from the card the user just viewed) —
      // whale/sweep detection needs it
      const summary = await getCollectionSummary(slug, chain).catch(() => null);
      const result = await trackCollection({
        chatId: ctx.chat!.id,
        userId: from.id,
        slug,
        chain,
        contractAddress: summary?.contractAddress,
        label: summary?.name,
      });
      const msg = result.reactivated
        ? `✅ Tracking resumed for <b>${slug}</b>.`
        : result.created
        ? `✅ Now tracking collection <b>${slug}</b>.\n\nUse /notifications to configure alerts.`
        : `ℹ️ You're already tracking <b>${slug}</b>.`;
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(msg, { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`❌ ${err.message ?? 'Failed to track collection.'}`);
    }
  });

  // Track asset (chain dropped from callback to stay under 64-byte Telegram limit)
  bot.callbackQuery(/^track_asset:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Tracking...');
    const [, contractAddress, tokenId] = ctx.match!;
    const chain = 'ethereum';
    const from = ctx.from!;
    try {
      const result = await trackAsset({
        chatId: ctx.chat!.id,
        userId: from.id,
        contractAddress,
        tokenId,
        chain,
      });
      const msg = result.created
        ? `✅ Now tracking asset <b>#${tokenId}</b>.\n\nUse /notifications to configure alerts.`
        : `ℹ️ You're already tracking this asset.`;
      await ctx.reply(msg, { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`❌ ${err.message ?? 'Failed to track asset.'}`);
    }
  });

  // Untrack
  bot.callbackQuery(/^untrack:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = parseInt(ctx.match![1]);
    const item = await prisma.trackedItem.findUnique({ where: { id } });
    if (!item) { await ctx.reply('Item not found.'); return; }

    if (item.type === 'COLLECTION') await untrackCollection(ctx.chat!.id, ctx.from!.id, id);
    else if (item.type === 'ASSET') await untrackAsset(ctx.chat!.id, id);
    else await prisma.trackedItem.update({ where: { id }, data: { isActive: false } });

    await ctx.reply(`✅ Stopped tracking <b>${item.label ?? item.collectionSlug ?? `#${item.tokenId}`}</b>.`, { parse_mode: 'HTML' });
  });

  // View ERC-721 owner (nft_owner: prefix, chain defaulted to ethereum)
  bot.callbackQuery(/^nft_owner:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Loading...');
    const [, contractAddress, tokenId] = ctx.match!;
    const chain = 'ethereum';
    const data = await getERC721Owner(contractAddress, tokenId, chain);
    if (!data) {
      await ctx.reply('⚠️ Owner data unavailable right now. Please try again later.');
      return;
    }
    await ctx.reply(formatERC721Owner(data), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Track Owner Change', callback_data: `track_asset:${contractAddress}:${tokenId}` }],
          [{ text: '🔙 Back', callback_data: 'cancel' }],
        ],
      },
    });
  });

  // View collection holders (col_holders: prefix, chain defaulted to ethereum)
  bot.callbackQuery(/^col_holders:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Loading...');
    const [, contractAddress] = ctx.match!;
    const chain = 'ethereum';
    const data = await getCollectionHolders(contractAddress, chain);
    if (!data) {
      await ctx.reply('⚠️ Holder data unavailable right now. Please try again later.');
      return;
    }
    await ctx.reply(formatCollectionHolders(data), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Refresh', callback_data: `col_holders:${contractAddress}` }],
          [{ text: '🔙 Back', callback_data: 'cancel' }],
        ],
      },
    });
  });

  // Notification settings for a tracked item
  bot.callbackQuery(/^notif_item:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = parseInt(ctx.match![1]);
    const item = await prisma.trackedItem.findUnique({ where: { id } });
    if (!item) { await ctx.reply('Item not found.'); return; }

    const keyboard = await buildNotifSettingsKeyboard(id, item.type);
    const label = item.label ?? item.collectionSlug ?? `#${item.tokenId}`;
    await ctx.reply(`🔔 <b>Notification Settings</b> — ${label}\n\nToggle event types:`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  // Toggle notification
  bot.callbackQuery(/^toggle_notif:(\d+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, idStr, eventType] = ctx.match!;
    const trackedItemId = parseInt(idStr);
    const item = await prisma.trackedItem.findUnique({ where: { id: trackedItemId } });
    if (!item) return;

    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    if (!dbChat) return;

    const existing = await prisma.notificationSetting.findFirst({ where: { trackedItemId, eventType } });
    if (existing) {
      await prisma.notificationSetting.update({
        where: { id: existing.id },
        data: { enabled: !existing.enabled },
      });
    } else {
      await prisma.notificationSetting.create({
        data: {
          trackedItemId,
          chatId: dbChat.id,
          userId: ctx.from!.id,
          eventType,
          enabled: true,
          cooldownMinutes: parseInt(config.ALERT_COOLDOWN_MINUTES as unknown as string),
        },
      });
    }

    const keyboard = await buildNotifSettingsKeyboard(trackedItemId, item.type);
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  });

  // Access: pending requests
  bot.callbackQuery('access_pending', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    const pending = await prisma.accessRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
      take: 10,
    });
    if (pending.length === 0) {
      await ctx.reply('✅ No pending requests.');
      return;
    }
    const keyboard = pending.map((r) => [
      { text: `✅ ${r.firstName ?? r.telegramUserId}`, callback_data: `approve_user:${r.telegramUserId}` },
      { text: `❌ Deny`, callback_data: `deny_user:${r.telegramUserId}` },
    ]);
    const lines = pending.map((r) => `• ${r.firstName ?? r.username ?? r.telegramUserId} (${r.telegramUserId})`);
    await ctx.reply(`📩 <b>Pending Requests</b>\n\n${lines.join('\n')}`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // Approve/deny user via button
  bot.callbackQuery(/^approve_user:(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery('Approving...');
    const targetId = ctx.match![1];
    const result = await (bot.approveUserById?.(String(ctx.from!.id), targetId) ?? Promise.resolve(`Approved ${targetId}`));
    await ctx.reply(result, { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^deny_user:(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery('Denying...');
    const targetId = ctx.match![1];
    const result = await (bot.denyUserById?.(String(ctx.from!.id), targetId) ?? Promise.resolve(`Denied ${targetId}`));
    await ctx.reply(result, { parse_mode: 'HTML' });
  });

  // Access status
  bot.callbackQuery('access_status', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userCount = await prisma.user.count({ where: { isApproved: true } });
    const trackedCount = await prisma.trackedItem.count({ where: { isActive: true } });
    const alertCount = await prisma.alertHistory.count();
    const chatCount = await prisma.chat.count({ where: { isApproved: true } });

    await ctx.reply(
      `📊 <b>Bot Status</b>\n\nApproved Users: ${userCount}\nApproved Chats: ${chatCount}\nActive Tracked Items: ${trackedCount}\nAlerts Sent (all time): ${alertCount}`,
      { parse_mode: 'HTML' }
    );
  });

  // Request access via button
  bot.callbackQuery('do_request_access', async (ctx) => {
    await ctx.answerCallbackQuery();
    const from = ctx.from!;
    const existing = await prisma.accessRequest.findFirst({
      where: { telegramUserId: String(from.id), status: 'PENDING' },
    });
    if (existing) {
      await ctx.reply('⏳ You already have a pending request.');
      return;
    }
    await prisma.accessRequest.create({
      data: {
        telegramUserId: String(from.id),
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        status: 'PENDING',
      },
    });
    await ctx.reply('📩 Access request sent. The administrator will review it shortly.');
    try {
      const nameDisplay = `${from.first_name ?? from.username ?? String(from.id)} (${from.id})`;
      await bot.api.sendMessage(
        config.OWNER_ID,
        `📩 <b>New Access Request</b>\n\n${nameDisplay}`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `approve_user:${from.id}` },
                { text: '❌ Deny', callback_data: `deny_user:${from.id}` },
              ],
            ],
          },
        }
      );
    } catch (err) {
      logger.error({ err }, 'Failed to notify owner');
    }
  });

  // Menu shortcuts
  bot.callbackQuery('menu_add_link', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('🔗 Paste an OpenSea link, collection slug, or contract address.');
  });

  bot.callbackQuery('menu_tracking', async (ctx) => {
    await ctx.answerCallbackQuery();
    // Manually trigger tracking display
    const chatIdStr = String(ctx.chat!.id);
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: chatIdStr } });
    if (!dbChat) { await ctx.reply('No tracked items.'); return; }
    const items = await prisma.trackedItem.findMany({ where: { chatId: dbChat.id, isActive: true } });
    if (items.length === 0) { await ctx.reply('📋 No tracked items yet. Use /link to add some.'); return; }
    const lines = items.map((i) => `• ${i.type === 'COLLECTION' ? '📁' : '🎨'} ${i.label ?? i.collectionSlug ?? `#${i.tokenId}`}`);
    await ctx.reply(`📋 <b>Tracked Items</b>\n\n${lines.join('\n')}\n\nUse /tracking for full management.`, { parse_mode: 'HTML' });
  });

  bot.callbackQuery('menu_holders', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('👥 Use /holders to view holder information.');
  });

  bot.callbackQuery('menu_notifications', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('🔔 Use /notifications to manage your alert settings.');
  });

  bot.callbackQuery('menu_access', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    const pendingCount = await prisma.accessRequest.count({ where: { status: 'PENDING' } });
    await ctx.reply(
      `🔑 <b>Access Panel</b>\n\nPending: ${pendingCount}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: `📩 Pending (${pendingCount})`, callback_data: 'access_pending' }],
            [{ text: '📊 Status', callback_data: 'access_status' }],
          ],
        },
      }
    );
  });
}
