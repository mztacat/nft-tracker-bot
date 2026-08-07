import { Context, NextFunction } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

export async function upsertUser(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  try {
    await prisma.user.upsert({
      where: { telegramId: String(from.id) },
      update: {
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        isOwner: String(from.id) === config.OWNER_ID,
      },
      create: {
        telegramId: String(from.id),
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        isApproved: String(from.id) === config.OWNER_ID,
        isAdmin: false,
        isOwner: String(from.id) === config.OWNER_ID,
      },
    });

    // Upsert chat record
    if (ctx.chat) {
      await prisma.chat.upsert({
        where: { telegramChatId: String(ctx.chat.id) },
        update: {
          title: 'title' in ctx.chat ? ctx.chat.title ?? null : null,
          type: ctx.chat.type,
          isApproved:
            ctx.chat.type === 'private'
              ? String(from.id) === config.OWNER_ID
              : undefined,
        },
        create: {
          telegramChatId: String(ctx.chat.id),
          type: ctx.chat.type,
          title: 'title' in ctx.chat ? ctx.chat.title ?? null : null,
          isApproved: ctx.chat.type === 'private' && String(from.id) === config.OWNER_ID,
        },
      });
    }
  } catch (err) {
    logger.error({ err }, 'upsertUser failed');
  }
}

export async function requireApproved(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  if (String(from.id) === config.OWNER_ID) {
    return next();
  }

  const isCommand = (ctx.message?.text ?? '').startsWith('/');

  // Group/channel: the chat approval is what matters — any member of an
  // approved group can use the bot there.
  if (ctx.chat && ctx.chat.type !== 'private') {
    const chat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat.id) } });
    if (chat?.isApproved) {
      return next();
    }
    // Unapproved group: only speak up when someone explicitly invokes a
    // command — never nag on regular conversation.
    if (isCommand) {
      await ctx.reply(
        `⛔ This group/channel is not approved to use the bot.\n\nChat id: <code>${ctx.chat.id}</code>\nAn admin can approve it with:\n<code>/approvegroup ${ctx.chat.id}</code>`,
        { parse_mode: 'HTML' }
      );
    }
    return;
  }

  // Private chat: per-user approval
  const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
  if (!user || !user.isApproved) {
    await ctx.reply(
      '⛔ You do not have access to this bot.\n\nUse /request to request access from the administrator.'
    );
    return;
  }

  return next();
}

export async function requireAdmin(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  if (String(from.id) === config.OWNER_ID) {
    return next();
  }

  const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
  if (!user || !user.isAdmin) {
    await ctx.reply('⛔ This command requires admin access.');
    return;
  }

  return next();
}

export async function requireOwner(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from || String(from.id) !== config.OWNER_ID) {
    await ctx.reply('⛔ This command is only available to the bot owner.');
    return;
  }
  return next();
}
