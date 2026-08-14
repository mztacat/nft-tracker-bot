import { prisma } from '../../db/client.js';
import { logger } from '../../logger.js';
import { Bot } from 'grammy';
import { formatAlertFloorChange, formatAlertSale, formatOwnerChangeAlert, formatDigest, formatWhaleBuyAlert } from '../formatter/index.js';
import { isItemSnoozed, buildSnoozeKeyboard } from '../../utils/snooze.js';

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

  if (await isItemSnoozed(trackedItemId)) return false;

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
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML', reply_markup: buildSnoozeKeyboard(trackedItemId) });
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
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML', reply_markup: buildSnoozeKeyboard(trackedItemId) });
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
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML', reply_markup: buildSnoozeKeyboard(trackedItemId) });
      const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
      if (dbChat) await markAlertSent(trackedItemId, dbChat.id, 'OWNER_CHANGE', message);
    } catch (err) {
      logger.error({ err }, 'Failed to send owner change alert');
    }
  }
}

export async function processWhaleBuyAlert(params: {
  trackedItemId: number;
  telegramChatId: string;
  collectionName: string;
  buyer: string;
  itemCount: number;
  ethSpent: number | null;
  txCount: number;
  windowMinutes: number;
  isSweep: boolean;
}): Promise<boolean> {
  const { trackedItemId, telegramChatId } = params;

  const setting = await prisma.notificationSetting.findFirst({
    where: { trackedItemId, eventType: 'WHALE_BUY', enabled: true },
  });
  if (!setting) return false;

  // Cheap pre-checks first — these must not consume the cooldown
  if (!_bot) return false;
  const withinCap = await checkDailyCapForChat(telegramChatId);
  if (!withinCap) return false;

  // Atomic cooldown claim immediately before sending: a single conditional
  // update so concurrent ticks/processes cannot both pass the cooldown gate
  const prevLastSentAt = setting.lastSentAt;
  const cooldownMs = (setting.cooldownMinutes ?? 5) * 60_000;
  const cutoff = new Date(Date.now() - cooldownMs);
  const claimed = await prisma.notificationSetting.updateMany({
    where: {
      id: setting.id,
      enabled: true,
      OR: [{ lastSentAt: null }, { lastSentAt: { lt: cutoff } }],
    },
    data: { lastSentAt: new Date() },
  });
  if (claimed.count === 0) return false;

  // Snooze check (whale path uses atomic cooldown claim, so check separately)
  if (await isItemSnoozed(trackedItemId)) return false;

  const message = formatWhaleBuyAlert(params);
  try {
    await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML', reply_markup: buildSnoozeKeyboard(trackedItemId) });
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
    if (dbChat) {
      await prisma.alertHistory.create({
        data: { trackedItemId, chatId: dbChat.id, eventType: 'WHALE_BUY', message },
      });
    }
    return true;
  } catch (err) {
    logger.error({ err, telegramChatId }, 'Failed to send whale buy alert');
    // Roll back the cooldown claim so a transient Telegram failure does not
    // suppress the next qualifying alert for the whole cooldown period
    await prisma.notificationSetting
      .update({ where: { id: setting.id }, data: { lastSentAt: prevLastSentAt } })
      .catch((rbErr) => logger.error({ rbErr }, 'Failed to roll back cooldown claim'));
    return false;
  }
}

/**
 * Generic alert sender for new event types (WHALE_BUY, LISTING, WALLET_ACTIVITY).
 * Applies notification-setting checks, cooldown, and the daily cap.
 */
export async function processGenericAlert(params: {
  trackedItemId: number;
  telegramChatId: string;
  eventType: string;
  message: string;
  defaultCooldownMinutes?: number;
}): Promise<boolean> {
  const { trackedItemId, telegramChatId, eventType, message, defaultCooldownMinutes = 5 } = params;

  const canSend = await canSendAlert(trackedItemId, eventType, defaultCooldownMinutes);
  if (!canSend) return false;

  const withinCap = await checkDailyCapForChat(telegramChatId);
  if (!withinCap) return false;

  if (!_bot) return false;
  try {
    await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML', reply_markup: buildSnoozeKeyboard(trackedItemId) });
    const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
    if (dbChat) await markAlertSent(trackedItemId, dbChat.id, eventType, message);
    return true;
  } catch (err) {
    logger.error({ err, eventType }, 'Failed to send alert');
    return false;
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
      await _bot.api.sendMessage(telegramChatId, message, { parse_mode: 'HTML', reply_markup: buildSnoozeKeyboard(trackedItemId) });
      const dbChat = await prisma.chat.findUnique({ where: { telegramChatId } });
      if (dbChat) await markAlertSent(trackedItemId, dbChat.id, 'DIGEST', message);
    } catch (err) {
      logger.error({ err }, 'Failed to send digest alert');
    }
  }
}
