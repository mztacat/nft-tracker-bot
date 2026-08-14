import type { Bot } from 'grammy';
import type { Context } from 'grammy';
import { logger } from '../logger.js';

const DELETE_DELAY_MS = 2 * 60 * 1_000; // 2 minutes

/** Schedule a single message for deletion after `delayMs` ms. Errors are silenced. */
export function scheduleDelete(
  bot: Bot,
  chatId: number | string,
  messageId: number,
  delayMs = DELETE_DELAY_MS
): void {
  setTimeout(() => {
    bot.api.deleteMessage(chatId, messageId).catch((err) => {
      // "message to delete not found" / "message can't be deleted" are expected — ignore them
      if (!String(err?.description ?? err?.message ?? '').includes('not found') &&
          !String(err?.description ?? err?.message ?? '').includes("can't be deleted")) {
        logger.debug({ err, chatId, messageId }, 'scheduleDelete: unexpected error');
      }
    });
  }, delayMs);
}

/** Returns true when the chat is a group or supergroup (not private/channel). */
export function isGroupChat(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === 'group' || type === 'supergroup';
}

/**
 * Send a reply and schedule it (+ the triggering command message) for deletion
 * after `delayMs` ms. Command-message deletion is attempted only in group chats.
 *
 * Returns the sent Message so callers can use message_id for further edits.
 */
export async function replyAutoDelete(
  ctx: Context,
  text: string,
  options: Record<string, unknown> = {},
  delayMs = DELETE_DELAY_MS
) {
  const msg = await ctx.reply(text, options as any);
  if (isGroupChat(ctx)) {
    scheduleDelete(ctx.api as any, ctx.chat!.id, msg.message_id, delayMs);
    // Also delete the triggering command message if available
    if (ctx.message?.message_id) {
      scheduleDelete(ctx.api as any, ctx.chat!.id, ctx.message.message_id, delayMs);
    }
  }
  return msg;
}

/**
 * Edit a message and reset its auto-delete timer (for paginated responses).
 * In group chats, schedules the updated message for deletion after `delayMs`.
 */
export async function editAutoDelete(
  ctx: Context,
  chatId: number | string,
  messageId: number,
  text: string,
  options: Record<string, unknown> = {},
  delayMs = DELETE_DELAY_MS
) {
  await ctx.api.editMessageText(chatId, messageId, text, options as any);
  if (isGroupChat(ctx)) {
    scheduleDelete(ctx.api as any, chatId, messageId, delayMs);
  }
}
