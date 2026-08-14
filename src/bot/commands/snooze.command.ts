import { Bot } from 'grammy';
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
  '<code>/snooze &lt;collection&gt; 1h</code>  — quiet for 1 hour',
  '<code>/snooze &lt;collection&gt; 6h</code>  — quiet for 6 hours',
  '<code>/snooze &lt;collection&gt; 1d</code>  — quiet for 1 day',
  '<code>/snooze &lt;collection&gt; off</code>  — mute indefinitely',
  '<code>/snooze &lt;collection&gt; on</code>   — un-snooze (resume alerts)',
  '<code>/snooze &lt;collection&gt;</code>       — show current status',
].join('\n');

export function registerSnoozeCommand(bot: Bot): void {
  bot.command('snooze', requireApproved, async (ctx) => {
    const raw = (ctx.match as string).trim();
    if (!raw) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const parts = raw.split(/\s+/);
    const collectionArg = parts[0]!;
    const durationArg = parts[1]?.toLowerCase() ?? '';

    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    if (!dbChat) {
      await replyAutoDelete(ctx, '⚠️ Please run /start first.');
      return;
    }

    const parsed = parseOpenSeaInput(collectionArg);
    if (!parsed) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const item = await prisma.trackedItem.findFirst({
      where: {
        chatId: dbChat.id,
        type: 'COLLECTION',
        isActive: true,
        OR: [
          { collectionSlug: parsed.value },
          { contractAddress: parsed.value },
          { label: { equals: parsed.value, mode: 'insensitive' } },
        ],
      },
    });

    if (!item) {
      await replyAutoDelete(ctx,
        `❌ No tracked collection matching <b>${collectionArg}</b>.\n\nCheck /tracking for your collections.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const name = item.label ?? item.collectionSlug ?? collectionArg;

    // Show status
    if (!durationArg) {
      const status = await getSnoozeStatus(item.id);
      const text = status
        ? `🔕 <b>${name}</b> — alerts snoozed\n${status}`
        : `🔔 <b>${name}</b> — alerts are active`;
      await replyAutoDelete(ctx, text, { parse_mode: 'HTML' });
      return;
    }

    // Unsnooze
    if (durationArg === 'on') {
      await unsnoozeItem(item.id);
      await replyAutoDelete(ctx,
        `🔔 <b>${name}</b> — alerts resumed`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Snooze
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
      ? 'until you resume with <code>/snooze ' + (item.collectionSlug ?? '') + ' on</code>'
      : `for <b>${dur.label}</b>`;
    await replyAutoDelete(ctx,
      `🔕 <b>${name}</b> — alerts snoozed ${suffix}`,
      { parse_mode: 'HTML' }
    );
  });
}
