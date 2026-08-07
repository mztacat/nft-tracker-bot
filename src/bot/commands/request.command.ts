import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

export function registerRequestCommand(bot: Bot): void {
  bot.command('request', async (ctx) => {
    const from = ctx.from!;
    if (String(from.id) === config.OWNER_ID) {
      await ctx.reply('You are the owner — access is automatic.');
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
    if (user?.isApproved) {
      await ctx.reply('✅ You already have access to the bot.');
      return;
    }

    const existing = await prisma.accessRequest.findFirst({
      where: { telegramUserId: String(from.id), status: 'PENDING' },
    });
    if (existing) {
      await ctx.reply('⏳ You already have a pending access request. Please wait for the administrator to review it.');
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

    await ctx.reply(
      '📩 <b>Access Request Sent</b>\n\nYour request has been sent to the administrator. You will be notified when it is reviewed.',
      { parse_mode: 'HTML' }
    );

    // Notify owner
    try {
      const nameDisplay = from.first_name
        ? `${from.first_name}${from.username ? ` (@${from.username})` : ''}`
        : from.username ?? String(from.id);

      await bot.api.sendMessage(
        config.OWNER_ID,
        `📩 <b>New Access Request</b>\n\nUser: <b>${nameDisplay}</b>\nID: <code>${from.id}</code>\n\nUse /approve ${from.id} to approve or /deny ${from.id} to deny.`,
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
      logger.error({ err }, 'Failed to notify owner of access request');
    }
  });
}
