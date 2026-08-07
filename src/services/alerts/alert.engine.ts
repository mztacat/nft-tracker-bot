import { prisma } from '../../db/client.js';
import { logger } from '../../logger.js';
import { Bot } from 'grammy';
import { formatAlertFloorChange, formatAlertSale, formatOwnerChangeAlert, formatDigest } from '../formatter/index.js';

const DAILY_ALERT_CAP = 100;

interface AlertContext {
  bot: Bot;
}

let _bot: Bot | null = null;

export function initAlertEngine(bot: Bot): void {
  _bot = bot;
}

async function canSendAlert(
  trackedItemId: number,
  eventType: string,
  cooldownMinutes: number
): Promise<boolean> {
  const setting = await prisma.notificationSetting.findFirst({
    where: { trackedItemId, eventType },
  });

  if (!setting || !setting.enabled) return false;

  if (setting.lastSentAt) {
    const cooldownMs = (setting.cooldownMinutes ?? cooldownMinutes) * 60_000;
    if (Date.now() - setting.lastSentAt.getTime() < cooldownMs) return false;
  }

  return true;
}

async function checkDailyCapForChat(telegramChatId: string): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
  if (!dbChat) return false;

  const count = await prisma.alertHistory.count({
    where: { chatId: dbChat.id, sentAt: { gte: today } },
  });
  return count < DAILY_ALERT_CAP;
}

async function markAlertSent(trackedItemId: number, chatId: number, eventType: string, message: string): Promise<void> {
  await prisma.notificationSetting.updateMany({
    where: { trackedItemId, eventType },
    data: { lastSentAt: new Date() },
  });
  await prisma.alertHistory.create({
    data: { trackedItemId, chatId, eventType, message },
  });
}

export async function processFloorChangeAlert(params: {
  trackedItemId: number;
  telegramChatId: string;
  collectionName: string;
  newFloor: number;
  prevFloor: number;
  chain: string;
  thresholdPct?: number;
}): Promise<void> {
  const { trackedItemId, telegramChatId, collectionName, newFloor, prevFloor, chain, thresholdPct = 5 } = params;

  const changePct = Math.abs(((newFloor - prevFloor) / prevFloor) * 100);
  if (changePct < thresholdPct) return;

  const canSend = await canSendAlert(trackedItemId, 'FLOOR_CHANGE', 30);
  if (!canSend) return;

  const withinCap = await checkDailyCapForChat(telegramChatId);
  if (!withinCap) return;

  const message = formatAlertFloorChange(collectionName, newFloor, prevFloor, chain);

  if (_bot) {
    try {
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML' });
      const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
      if (dbChat) await markAlertSent(trackedItemId, dbChat.id, 'FLOOR_CHANGE', message);
    } catch (err) {
      logger.error({ err, telegramChatId }, 'Failed to send floor change alert');
    }
  }
}

export async function processSaleAlert(params: {
  trackedItemId: number;
  telegramChatId: string;
  collectionName: string;
  tokenId: string;
  price: number;
  minPrice?: number;
}): Promise<void> {
  const { trackedItemId, telegramChatId, collectionName, tokenId, price, minPrice = 0 } = params;

  if (price < minPrice) return;

  const canSend = await canSendAlert(trackedItemId, 'SALE', 5);
  if (!canSend) return;

  const withinCap = await checkDailyCapForChat(telegramChatId);
  if (!withinCap) return;

  const message = formatAlertSale(collectionName, tokenId, price);
  if (_bot) {
    try {
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML' });
      const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
      if (dbChat) await markAlertSent(trackedItemId, dbChat.id, 'SALE', message);
    } catch (err) {
      logger.error({ err }, 'Failed to send sale alert');
    }
  }
}

export async function processOwnerChangeAlert(params: {
  trackedItemId: number;
  telegramChatId: string;
  collectionName: string;
  tokenId: string;
  newOwner: string;
  oldOwner?: string | null;
}): Promise<void> {
  const { trackedItemId, telegramChatId, collectionName, tokenId, newOwner, oldOwner } = params;

  const canSend = await canSendAlert(trackedItemId, 'OWNER_CHANGE', 5);
  if (!canSend) return;

  const withinCap = await checkDailyCapForChat(telegramChatId);
  if (!withinCap) return;

  const message = formatOwnerChangeAlert(collectionName, tokenId, newOwner, oldOwner);
  if (_bot) {
    try {
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML' });
      const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
      if (dbChat) await markAlertSent(trackedItemId, dbChat.id, 'OWNER_CHANGE', message);
    } catch (err) {
      logger.error({ err }, 'Failed to send owner change alert');
    }
  }
}

export async function sendDigestAlert(params: {
  trackedItemId: number;
  telegramChatId: string;
  collectionName: string;
  stats: {
    sales: number;
    volume: number;
    floor: number;
    floorChange: number | null;
    newListings: number;
    delistings: number;
    whaleBuys: number;
  };
}): Promise<void> {
  const { trackedItemId, telegramChatId, collectionName, stats } = params;

  const canSend = await canSendAlert(trackedItemId, 'DIGEST', 60);
  if (!canSend) return;

  const withinCap = await checkDailyCapForChat(telegramChatId);
  if (!withinCap) return;

  const message = formatDigest(collectionName, stats);
  if (_bot) {
    try {
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML' });
      const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
      if (dbChat) await markAlertSent(trackedItemId, dbChat.id, 'DIGEST', message);
    } catch (err) {
      logger.error({ err }, 'Failed to send digest alert');
    }
  }
}
