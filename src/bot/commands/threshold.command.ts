import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { parseOpenSeaInput } from '../../utils/opensea-url.js';
import { replyAutoDelete } from '../../utils/auto-delete.js';

const DEFAULT_FLOOR_PCT = 5;
const DEFAULT_WHALE_ETH = 5;
const DEFAULT_WHALE_ITEMS = 3;

const USAGE = [
  '⚙️ <b>Alert Thresholds</b>',
  '',
  'Reduce noise by raising the bar for when alerts fire.',
  '',
  '<b>Floor change threshold</b>',
  '<code>/setthreshold &lt;collection&gt; &lt;pct&gt;</code>',
  'e.g. <code>/setthreshold fuego 10</code>  — only alert on ≥10% floor moves',
  '',
  '<b>Whale buy threshold</b>',
  '<code>/setthreshold &lt;collection&gt; whale &lt;ETH&gt;</code>',
  'e.g. <code>/setthreshold fuego whale 3</code>  — only alert when a wallet spends ≥3 ETH',
  '',
  '<b>View current thresholds</b>',
  '<code>/setthreshold &lt;collection&gt;</code>',
].join('\n');

export function registerThresholdCommand(bot: Bot): void {
  bot.command('setthreshold', requireApproved, async (ctx) => {
    const raw = (ctx.match as string).trim();
    if (!raw) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const parts = raw.split(/\s+/);
    const collectionArg = parts[0]!;
    const rest = parts.slice(1);

    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    if (!dbChat) {
      await replyAutoDelete(ctx, '⚠️ Please run /start first.');
      return;
    }

    // Resolve collection slug from arg (URL or plain slug)
    const parsed = parseOpenSeaInput(collectionArg);
    if (!parsed) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }
    const slugOrAddr = parsed.value;

    const item = await prisma.trackedItem.findFirst({
      where: {
        chatId: dbChat.id,
        type: 'COLLECTION',
        isActive: true,
        OR: [
          { collectionSlug: slugOrAddr },
          { contractAddress: slugOrAddr },
          { label: { equals: slugOrAddr, mode: 'insensitive' } },
        ],
      },
      include: { notificationSettings: true },
    });

    if (!item) {
      await replyAutoDelete(ctx,
        `❌ No tracked collection matching <b>${collectionArg}</b>.\n\nCheck /tracking for your tracked collections.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const collectionName = item.label ?? item.collectionSlug ?? collectionArg;

    // /setthreshold <collection> — show current settings
    if (rest.length === 0) {
      const floorNotif = item.notificationSettings.find((s) => s.eventType === 'FLOOR_CHANGE');
      const whaleNotif = item.notificationSettings.find((s) => s.eventType === 'WHALE_BUY');
      const floorPct = (floorNotif?.thresholdJson as any)?.pct ?? DEFAULT_FLOOR_PCT;
      const whaleEth = (whaleNotif?.thresholdJson as any)?.minEth ?? DEFAULT_WHALE_ETH;
      const whaleItems = (whaleNotif?.thresholdJson as any)?.minItems ?? DEFAULT_WHALE_ITEMS;

      await replyAutoDelete(ctx, [
        `⚙️ <b>Thresholds for ${collectionName}</b>`,
        '',
        `📉 Floor change  ≥ <b>${floorPct}%</b>`,
        `🐋 Whale buy  ≥ <b>${whaleEth} ETH</b> or ≥ <b>${whaleItems} items</b>`,
        '',
        'Change with:',
        `<code>/setthreshold ${item.collectionSlug} &lt;pct&gt;</code>`,
        `<code>/setthreshold ${item.collectionSlug} whale &lt;ETH&gt;</code>`,
      ].join('\n'), { parse_mode: 'HTML' });
      return;
    }

    // /setthreshold <collection> whale <eth>
    if (rest[0]?.toLowerCase() === 'whale') {
      const eth = parseFloat(rest[1] ?? '');
      if (isNaN(eth) || eth <= 0) {
        await replyAutoDelete(ctx,
          '❌ Provide a positive ETH value, e.g. <code>/setthreshold fuego whale 3</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const whaleNotif = item.notificationSettings.find((s) => s.eventType === 'WHALE_BUY');
      const existingItems = (whaleNotif?.thresholdJson as any)?.minItems ?? DEFAULT_WHALE_ITEMS;

      await prisma.notificationSetting.upsert({
        where: { trackedItemId_eventType: { trackedItemId: item.id, eventType: 'WHALE_BUY' } },
        create: {
          trackedItemId: item.id,
          chatId: dbChat.id,
          eventType: 'WHALE_BUY',
          enabled: true,
          thresholdJson: { minEth: eth, minItems: existingItems },
        },
        update: { thresholdJson: { minEth: eth, minItems: existingItems } },
      });

      await replyAutoDelete(ctx,
        `✅ <b>${collectionName}</b> — whale alerts now require ≥ <b>${eth} ETH</b> spend\n\n<i>Smaller buys will be silently ignored.</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // /setthreshold <collection> <pct>
    const pct = parseFloat(rest[0] ?? '');
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      await replyAutoDelete(ctx,
        '❌ Provide a percentage between 1–100, e.g. <code>/setthreshold fuego 10</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const floorNotif = item.notificationSettings.find((s) => s.eventType === 'FLOOR_CHANGE');
    const existingThresholdJson = (floorNotif?.thresholdJson as any) ?? {};

    await prisma.notificationSetting.upsert({
      where: { trackedItemId_eventType: { trackedItemId: item.id, eventType: 'FLOOR_CHANGE' } },
      create: {
        trackedItemId: item.id,
        chatId: dbChat.id,
        eventType: 'FLOOR_CHANGE',
        enabled: true,
        thresholdJson: { ...existingThresholdJson, pct },
      },
      update: { thresholdJson: { ...existingThresholdJson, pct } },
    });

    await replyAutoDelete(ctx,
      `✅ <b>${collectionName}</b> — floor alerts now require ≥ <b>${pct}%</b> change\n\n<i>Tiny bounces will be silently ignored.</i>`,
      { parse_mode: 'HTML' }
    );
  });
}
