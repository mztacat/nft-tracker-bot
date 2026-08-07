import { Bot } from 'grammy';
import { requireAdmin, requireOwner } from '../middlewares/auth.middleware.js';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

async function approveUserById(bot: Bot, adminId: string, targetId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) return `❌ User ${targetId} not found.`;

  await prisma.user.update({ where: { telegramId: targetId }, data: { isApproved: true } });
  await prisma.accessRequest.updateMany({
    where: { telegramUserId: targetId, status: 'PENDING' },
    data: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: adminId },
  });

  // Ensure their private chat is approved too
  try {
    const chat = await prisma.chat.findFirst({ where: { telegramChatId: targetId } });
    if (chat) await prisma.chat.update({ where: { id: chat.id }, data: { isApproved: true } });
  } catch {}

  try {
    await bot.api.sendMessage(
      targetId,
      '✅ <b>Access Granted</b>\n\nYour request has been approved. You can now use the bot.\n\nUse /menu to get started.',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to notify user of approval');
  }

  const name = user.firstName ?? user.username ?? targetId;
  return `✅ User <b>${name}</b> (${targetId}) has been approved.`;
}

async function denyUserById(bot: Bot, adminId: string, targetId: string): Promise<string> {
  await prisma.user.updateMany({ where: { telegramId: targetId }, data: { isApproved: false } });
  await prisma.accessRequest.updateMany({
    where: { telegramUserId: targetId, status: 'PENDING' },
    data: { status: 'DENIED', reviewedAt: new Date(), reviewedBy: adminId },
  });

  try {
    await bot.api.sendMessage(targetId, '❌ Your access request has been denied.');
  } catch {}

  return `❌ User ${targetId} has been denied.`;
}

export function registerAccessCommands(bot: Bot): void {
  // /access — admin panel
  bot.command('access', requireAdmin, async (ctx) => {
    const pendingCount = await prisma.accessRequest.count({ where: { status: 'PENDING' } });
    const userCount = await prisma.user.count({ where: { isApproved: true } });
    const adminCount = await prisma.user.count({ where: { isAdmin: true } });

    await ctx.reply(
      `🔑 <b>Admin Access Panel</b>\n\nPending Requests: <b>${pendingCount}</b>\nApproved Users: <b>${userCount}</b>\nAdmins: <b>${adminCount}</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: `📩 Pending Requests (${pendingCount})`, callback_data: 'access_pending' }],
            [{ text: '👥 Users', callback_data: 'access_users' }],
            [{ text: '🔑 Admins', callback_data: 'access_admins' }],
            [{ text: '📢 Broadcast', callback_data: 'access_broadcast' }],
            [{ text: '📊 Bot Status', callback_data: 'access_status' }],
          ],
        },
      }
    );
  });

  // /requests — list pending
  bot.command('requests', requireAdmin, async (ctx) => {
    const pending = await prisma.accessRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
      take: 20,
    });

    if (pending.length === 0) {
      await ctx.reply('✅ No pending access requests.');
      return;
    }

    const lines = pending.map((r, i) => {
      const name = r.firstName ?? r.username ?? r.telegramUserId;
      return `${i + 1}. <b>${name}</b> (${r.telegramUserId})${r.username ? ` @${r.username}` : ''}`;
    });

    const keyboard = pending.slice(0, 8).map((r) => [
      { text: `✅ ${r.firstName ?? r.telegramUserId}`, callback_data: `approve_user:${r.telegramUserId}` },
      { text: `❌ Deny`, callback_data: `deny_user:${r.telegramUserId}` },
    ]);

    await ctx.reply(
      `📩 <b>Pending Access Requests</b>\n\n${lines.join('\n')}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
    );
  });

  // /approve <user_id>
  bot.command('approve', requireAdmin, async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply('Usage: /approve <user_id>');
      return;
    }
    const result = await approveUserById(bot, String(ctx.from!.id), args);
    await ctx.reply(result, { parse_mode: 'HTML' });
  });

  // /deny <user_id>
  bot.command('deny', requireAdmin, async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply('Usage: /deny <user_id>');
      return;
    }
    const result = await denyUserById(bot, String(ctx.from!.id), args);
    await ctx.reply(result, { parse_mode: 'HTML' });
  });

  // /approvegroup <chat_id>
  bot.command('approvegroup', requireAdmin, async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) { await ctx.reply('Usage: /approvegroup <chat_id>'); return; }
    try {
      await prisma.chat.upsert({
        where: { telegramChatId: args },
        update: { isApproved: true },
        create: { telegramChatId: args, type: 'group', isApproved: true },
      });
      await ctx.reply(`✅ Group/channel ${args} approved.`);
    } catch (err) {
      await ctx.reply(`❌ Failed: ${String(err)}`);
    }
  });

  // /denygroup <chat_id>
  bot.command('denygroup', requireAdmin, async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) { await ctx.reply('Usage: /denygroup <chat_id>'); return; }
    await prisma.chat.updateMany({ where: { telegramChatId: args }, data: { isApproved: false } });
    await ctx.reply(`❌ Group/channel ${args} denied.`);
  });

  // /addadmin <user_id>
  bot.command('addadmin', requireOwner, async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) { await ctx.reply('Usage: /addadmin <user_id>'); return; }
    await prisma.user.updateMany({ where: { telegramId: args }, data: { isAdmin: true, isApproved: true } });
    await ctx.reply(`✅ User ${args} is now an admin.`);
  });

  // /removeadmin <user_id>
  bot.command('removeadmin', requireOwner, async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) { await ctx.reply('Usage: /removeadmin <user_id>'); return; }
    if (args === config.OWNER_ID) { await ctx.reply('Cannot remove owner.'); return; }
    await prisma.user.updateMany({ where: { telegramId: args }, data: { isAdmin: false } });
    await ctx.reply(`✅ Admin removed for user ${args}.`);
  });

  // /admins
  bot.command('admins', requireAdmin, async (ctx) => {
    const admins = await prisma.user.findMany({ where: { isAdmin: true } });
    if (admins.length === 0) { await ctx.reply('No admins configured.'); return; }
    const lines = admins.map((a) => `• ${a.firstName ?? a.username ?? a.telegramId} (${a.telegramId})`);
    await ctx.reply(`<b>Admins</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  // /broadcast
  bot.command('broadcast', requireAdmin, async (ctx) => {
    const msg = ctx.match?.trim();
    if (!msg) { await ctx.reply('Usage: /broadcast <message>'); return; }

    const users = await prisma.user.findMany({ where: { isApproved: true } });
    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await bot.api.sendMessage(user.telegramId, `📢 <b>Broadcast</b>\n\n${msg}`, { parse_mode: 'HTML' });
        sent++;
      } catch {
        failed++;
      }
      await delay(50);
    }

    await ctx.reply(`📢 Broadcast complete.\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
  });

  // Expose helpers for callback handler
  bot.approveUserById = (adminId: string, targetId: string) => approveUserById(bot, adminId, targetId);
  bot.denyUserById = (adminId: string, targetId: string) => denyUserById(bot, adminId, targetId);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Augment Bot type for helpers
declare module 'grammy' {
  interface Bot {
    approveUserById?: (adminId: string, targetId: string) => Promise<string>;
    denyUserById?: (adminId: string, targetId: string) => Promise<string>;
  }
}
