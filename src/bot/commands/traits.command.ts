import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { parseOpenSeaInput } from '../../utils/opensea-url.js';
import { replyAutoDelete } from '../../utils/auto-delete.js';
import { requireApproved } from '../middlewares/auth.middleware.js';

const USAGE =
  '🏷 <b>Trait Listing Alerts</b>\n\n' +
  'Get pinged when an NFT with a specific trait is listed for sale.\n\n' +
  'Usage:\n' +
  '• <code>/traitalert &lt;collection&gt; &lt;Trait&gt;=&lt;Value&gt;</code>\n' +
  '• <code>/traitalert &lt;collection&gt; off</code>\n\n' +
  'Examples:\n' +
  '• <code>/traitalert ploplo-genesis Tier=Legendary</code>\n' +
  '• <code>/traitalert azuki Type=Spirit</code>\n\n' +
  'The collection must already be tracked (paste its OpenSea link, then 📌 Track).';

export function registerTraitsCommand(bot: Bot): void {
  bot.command('traitalert', requireApproved, async (ctx) => {
    const args = (ctx.match as string).trim();
    if (!args) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const parts = args.split(/\s+/);
    const rawSlugArg = parts[0] ?? '';
    const parsed = parseOpenSeaInput(rawSlugArg);
    // For trait alerts we always need a slug (address alone isn't enough to look up tracked item)
    const slug = parsed?.kind === 'slug' ? parsed.value : parsed?.kind === 'address' ? parsed.value : rawSlugArg.toLowerCase().replace(/[.,;:!?]+$/, '');
    const rest = parts.slice(1).join(' ');
    if (!slug || !rest) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    if (!dbChat) {
      await replyAutoDelete(ctx, '⚠️ Please run /start first.');
      return;
    }

    const item = await prisma.trackedItem.findFirst({
      where: { chatId: dbChat.id, type: 'COLLECTION', collectionSlug: slug, isActive: true },
    });
    if (!item) {
      await replyAutoDelete(ctx,
        `⚠️ You're not tracking <b>${slug}</b> yet.\n\nPaste its OpenSea link and hit 📌 Track Collection first.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Turn off
    if (rest.toLowerCase() === 'off') {
      await prisma.notificationSetting.updateMany({
        where: { trackedItemId: item.id, eventType: 'TRAIT_LISTING' },
        data: { enabled: false },
      });
      await replyAutoDelete(ctx, `✅ Trait alerts disabled for <b>${slug}</b>.`, { parse_mode: 'HTML' });
      return;
    }

    // Parse Trait=Value (value may contain spaces)
    const eq = rest.indexOf('=');
    if (eq < 1) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }
    const traitType = rest.slice(0, eq).trim();
    const traitValue = rest.slice(eq + 1).trim();
    if (!traitType || !traitValue) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const dbUser = await prisma.user.findUnique({ where: { telegramId: String(ctx.from!.id) } });

    await prisma.notificationSetting.upsert({
      where: { trackedItemId_eventType: { trackedItemId: item.id, eventType: 'TRAIT_LISTING' } },
      create: {
        trackedItemId: item.id,
        chatId: dbChat.id,
        userId: dbUser?.id ?? null,
        eventType: 'TRAIT_LISTING',
        enabled: true,
        cooldownMinutes: 0,
        thresholdJson: { traitType, traitValue },
      },
      update: {
        enabled: true,
        thresholdJson: { traitType, traitValue },
      },
    });

    await replyAutoDelete(ctx,
      `✅ Trait alert set for <b>${slug}</b>\n\nYou'll be notified whenever an NFT with <b>${traitType} = ${traitValue}</b> is listed for sale.\n\nTurn off with <code>/traitalert ${slug} off</code>`,
      { parse_mode: 'HTML' }
    );
  });
}
