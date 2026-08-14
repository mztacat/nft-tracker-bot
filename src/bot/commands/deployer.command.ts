import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { requireApproved } from '../middlewares/auth.middleware.js';
import { getContractDeployer } from '../../services/providers/deployer.js';
import { parseOpenSeaInput } from '../../utils/opensea-url.js';
import { replyAutoDelete, scheduleDelete, isGroupChat } from '../../utils/auto-delete.js';
import { getOpenSeaCollection } from '../../services/providers/opensea.enhancer.js';

const ETH_ADDR = /^0x[0-9a-fA-F]{40}$/;

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const USAGE =
  '🚀 <b>Deployer Watch</b>\n\n' +
  'Get alerted when the team behind a collection deploys a NEW contract (next mint, new token) — before any announcement.\n\n' +
  'Usage:\n' +
  '• <code>/trackdeployer &lt;contract_address&gt;</code> — watch the deployer of that collection\n' +
  '• <code>/trackdeployer &lt;slug&gt;</code> — works for tracked collections too';

export function registerDeployerCommand(bot: Bot): void {
  bot.command('trackdeployer', requireApproved, async (ctx) => {
    const arg = (ctx.match as string).trim().split(/\s+/)[0] ?? '';
    if (!arg) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId: String(ctx.chat!.id) } });
    const dbUser = await prisma.user.findUnique({ where: { telegramId: String(ctx.from!.id) } });
    if (!dbChat || !dbUser) {
      await replyAutoDelete(ctx, '⚠️ Please run /start first.');
      return;
    }

    // Resolve to a contract address — accept full OpenSea URLs too
    const parsed = parseOpenSeaInput(arg);
    if (!parsed) {
      await replyAutoDelete(ctx, USAGE, { parse_mode: 'HTML' });
      return;
    }

    let contract: string | null = null;
    let sourceName: string | null = null;
    if (parsed.kind === 'address') {
      contract = parsed.value;
    } else {
      const slug = parsed.value;
      // 1. Check tracked items first
      const item = await prisma.trackedItem.findFirst({
        where: { chatId: dbChat.id, type: 'COLLECTION', collectionSlug: slug, isActive: true },
      });
      if (item?.contractAddress) {
        contract = item.contractAddress.toLowerCase();
        sourceName = item.label ?? slug;
      } else {
        // 2. Fall back to OpenSea API to resolve slug → contract
        const info = await getOpenSeaCollection(slug);
        if (info?.contractAddress) {
          contract = info.contractAddress.toLowerCase();
          sourceName = info.name;
        }
      }
    }
    if (!contract) {
      await replyAutoDelete(ctx,
        '❌ Give me a contract address (0x…), an OpenSea URL, or the slug of a collection you already track.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const waitMsg = await replyAutoDelete(ctx, '⏳ Looking up the deployer...');
    const deployer = await getContractDeployer(contract);
    if (!deployer) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        waitMsg.message_id,
        '⚠️ Could not determine the deployer for that contract.'
      );
      return;
    }

    const label = `deployer of ${sourceName ?? shortAddr(contract)}`;

    // Reuse WALLET tracking with a DEPLOYER_ACTIVITY setting
    const existing = await prisma.trackedItem.findFirst({
      where: { chatId: dbChat.id, type: 'WALLET', walletAddress: deployer },
    });
    let itemId: number;
    if (existing) {
      await prisma.trackedItem.update({
        where: { id: existing.id },
        data: { isActive: true, isPaused: false, label: existing.label ?? label },
      });
      itemId = existing.id;
    } else {
      const item = await prisma.trackedItem.create({
        data: {
          chatId: dbChat.id,
          ownerUserId: dbUser.id,
          type: 'WALLET',
          chain: 'ethereum',
          walletAddress: deployer,
          label,
          isActive: true,
        },
      });
      itemId = item.id;
    }

    await prisma.notificationSetting.upsert({
      where: { trackedItemId_eventType: { trackedItemId: itemId, eventType: 'DEPLOYER_ACTIVITY' } },
      create: {
        trackedItemId: itemId,
        chatId: dbChat.id,
        userId: dbUser.id,
        eventType: 'DEPLOYER_ACTIVITY',
        enabled: true,
        cooldownMinutes: 0,
      },
      update: { enabled: true },
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      `✅ <b>Deployer Watch active</b>\n\nDeployer  <code>${shortAddr(deployer)}</code> (${label})\n\nYou'll be alerted the moment this wallet deploys a new NFT contract or token.\n\nManage it under /wallets.`,
      { parse_mode: 'HTML' }
    );
  });
}
