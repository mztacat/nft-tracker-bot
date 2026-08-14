import { Bot, InlineKeyboard } from 'grammy';
import { prisma } from '../../db/client.js';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { parseOpenSeaInput } from '../../utils/opensea-url.js';
import { replyAutoDelete } from '../../utils/auto-delete.js';
import { snoozeItem, unsnoozeItem, getSnoozeStatus, SNOOZE_DURATIONS } from '../../utils/snooze.js';

const USAGE = [
  '🔕 <b>Snooze Alerts</b>',
  '',
  'Temporarily silence all alerts for a collection.',
  '',
  '<b>Reply to any alert</b> with <code>/snooze</code> to pick a duration,',
  'or include it directly: <code>/snooze 1h</code>',
  '',
  '<b>Or specify by name:</b>',
  '<code>/snooze &lt;collection&gt; 1h</code>  — quiet for 1 hour',
  '<code>/snooze &lt;collection&gt; 6h</code>  — quiet for 6 hours',
  '<code>/snooze &lt;collection&gt; 1d</code>  — quiet for 1 day',
  '<code>/snooze &lt;collection&gt; off</code>  — mute indefinitely',
  '<code>/snooze &lt;collection&gt; on</code>   — un-snooze (resume alerts)',
  '<code>/snooze &lt;collection&gt;</code>       — show current status',
].join('\n');

/** Extract collection name from an alert message's plain text. */
function extractCollectionFromAlertText(text: string): string | null {
  // "Collection: Name" pattern (floor, whale, sale, trait alerts)
  const collMatch = text.match(/Collection:\s*(.+?)(?:\n|$)/);
  if (collMatch?.[1]) return collMatch[1].trim();

  // First non-empty line may be "Name #tokenId" (snipe alerts)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Skip emoji/header lines, look for the collection name line
  for (const line of lines.slice(1, 4)) {
    if (!line.startsWith('📊') && !line.startsWith('🐋') &&
        !line.startsWith('🧹') && !line.startsWith('🎯') &&
        !line.startsWith('💎') && !line.startsWith('🏷') &&
        !line.startsWith('🚀') && line.length < 60) {
      // Strip token ID suffix like " #478"
      return line.replace(/\s*#\d+.*$/, '').trim() || null;
    }
  }
  return null;
}

async function findTrackedItem(collectionHint: string, chatId: number) {
  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(chatId) } });
  if (!dbChat) return null;

  // Try direct label / slug / address match first
  const parsed = parseOpenSeaInput(collectionHint);
  const slugOrAddr = parsed?.value ?? collectionHint;

  return prisma.trackedItem.findFirst({
    where: {
      chatId: dbChat.id,
      type: 'COLLECTION',
      isActive: true,
      OR: [
        { collectionSlug: { equals: slugOrAddr, mode: 'insensitive' } },
        { contractAddress: slugOrAddr },
        { label: { equals: collectionHint, mode: 'insensitive' } },
        { label: { contains: collectionHint, mode: 'insensitive' } },
      ],
    },
  });
}

function buildDurationKeyboard(itemId: number) {
  return new InlineKeyboard()
    .text('🕐 1H',   `snooze:1h:${itemId}`)
    .text('🕕 6H',   `snooze:6h:${itemId}`)
    .text('📅 1D',   `snooze:1d:${itemId}`)
    .text('🔕 Mute', `snooze:off:${itemId}`);
}

export function registerSnoozeCommand(bot: Bot): void {
  bot.command('snooze', requireApproved, async (ctx) => {
    const raw = (ctx.match as string).trim();
    const chatId = ctx.chat!.id;

    // ── Reply mode: /snooze (or /snooze <duration>) while quoting an alert ──
    const repliedText = ctx.message?.reply_to_message?.text;
    if (repliedText) {
      const collectionName = extractCollectionFromAlertText(repliedText);
      if (!collectionName) {
        await replyAutoDelete(ctx,
          '❓ Could not detect a collection from the quoted message.\n\nTry <code>/snooze &lt;collection&gt; 1h</code> instead.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const item = await findTrackedItem(collectionName, chatId);
      if (!item) {
        await replyAutoDelete(ctx,
          `❌ Collection "<b>${collectionName}</b>" is not in your tracked list.\n\nCheck /tracking.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const name = item.label ?? item.collectionSlug ?? collectionName;

      // /snooze with just a duration arg while replying
      const durationArg = raw.toLowerCase();
      if (durationArg && SNOOZE_DURATIONS[durationArg]) {
        await snoozeItem(item.id, durationArg);
        const dur = SNOOZE_DURATIONS[durationArg]!;
        const suffix = dur.ms === null ? 'indefinitely' : `for <b>${dur.label}</b>`;
        await replyAutoDelete(ctx,
          `🔕 <b>${name}</b> snoozed ${suffix}`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (durationArg === 'on') {
        await unsnoozeItem(item.id);
        await replyAutoDelete(ctx, `🔔 <b>${name}</b> — alerts resumed`, { parse_mode: 'HTML' });
        return;
      }

      // No duration → show picker buttons
      const status = await getSnoozeStatus(item.id);
      const statusLine = status ? `\n<i>Currently snoozed: ${status}</i>` : '';
      await ctx.reply(
        `🔕 Snooze alerts for <b>${name}</b>?${statusLine}`,
        { parse_mode: 'HTML', reply_markup: buildDurationKeyboard(item.id) }
      );
      return;
    }

    // ── Normal mode: /snooze <collection> [duration] ──
    if (!raw) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const parts = raw.split(/\s+/);
    const collectionArg = parts[0]!;
    const durationArg = parts[1]?.toLowerCase() ?? '';

    const item = await findTrackedItem(collectionArg, chatId);
    if (!item) {
      await replyAutoDelete(ctx,
        `❌ No tracked collection matching <b>${collectionArg}</b>.\n\nCheck /tracking for your collections.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const name = item.label ?? item.collectionSlug ?? collectionArg;

    if (!durationArg) {
      const status = await getSnoozeStatus(item.id);
      const statusLine = status ? `\n<i>Currently snoozed: ${status}</i>` : '';
      await ctx.reply(
        `🔕 Snooze alerts for <b>${name}</b>?${statusLine}`,
        { parse_mode: 'HTML', reply_markup: buildDurationKeyboard(item.id) }
      );
      return;
    }

    if (durationArg === 'on') {
      await unsnoozeItem(item.id);
      await replyAutoDelete(ctx, `🔔 <b>${name}</b> — alerts resumed`, { parse_mode: 'HTML' });
      return;
    }

    if (!SNOOZE_DURATIONS[durationArg]) {
      await replyAutoDelete(ctx,
        `❌ Unknown duration <b>${durationArg}</b>. Use: <code>1h</code>, <code>6h</code>, <code>1d</code>, <code>off</code>, or <code>on</code>.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await snoozeItem(item.id, durationArg);
    const dur = SNOOZE_DURATIONS[durationArg]!;
    const suffix = dur.ms === null
      ? `indefinitely — resume with <code>/snooze ${item.collectionSlug ?? ''} on</code>`
      : `for <b>${dur.label}</b>`;
    await replyAutoDelete(ctx,
      `🔕 <b>${name}</b> — alerts snoozed ${suffix}`,
      { parse_mode: 'HTML' }
    );
  });
}
