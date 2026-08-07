/**
 * Tests for processWhaleBuyAlert cooldown semantics:
 * - daily-cap rejection must not consume lastSentAt
 * - Telegram send failure must roll back the cooldown claim
 * - successful send keeps the claim and records history
 */
jest.mock('../db/client', () => ({
  prisma: {
    notificationSetting: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    alertHistory: {
      count: jest.fn(),
      create: jest.fn(),
    },
    chat: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../db/client';
import { initAlertEngine, processWhaleBuyAlert } from '../services/alerts/alert.engine';

const mockPrisma = prisma as any;

const baseParams = {
  trackedItemId: 1,
  telegramChatId: '12345',
  collectionName: 'Azuki',
  buyer: '0xwhale',
  itemCount: 4,
  ethSpent: 8,
  txCount: 2,
  windowMinutes: 10,
  isSweep: true,
};

function setupDefaults() {
  mockPrisma.notificationSetting.findFirst.mockResolvedValue({
    id: 7,
    lastSentAt: null,
    cooldownMinutes: 5,
    enabled: true,
  });
  mockPrisma.notificationSetting.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.notificationSetting.update.mockResolvedValue({});
  mockPrisma.alertHistory.count.mockResolvedValue(0); // under daily cap
  mockPrisma.alertHistory.create.mockResolvedValue({});
  mockPrisma.chat.findUnique.mockResolvedValue({ id: 42, telegramChatId: '12345' });
}

describe('processWhaleBuyAlert', () => {
  let sendMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaults();
    sendMessage = jest.fn().mockResolvedValue({});
    initAlertEngine({ api: { sendMessage } } as any);
  });

  it('sends and keeps the cooldown claim on success', async () => {
    await processWhaleBuyAlert(baseParams);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notificationSetting.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notificationSetting.update).not.toHaveBeenCalled(); // no rollback
    expect(mockPrisma.alertHistory.create).toHaveBeenCalledTimes(1);
  });

  it('does not claim the cooldown when the daily cap is exhausted', async () => {
    mockPrisma.alertHistory.count.mockResolvedValue(1000); // over cap
    await processWhaleBuyAlert(baseParams);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mockPrisma.notificationSetting.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back the cooldown claim when Telegram send fails', async () => {
    const prevDate = new Date('2026-08-07T10:00:00Z');
    mockPrisma.notificationSetting.findFirst.mockResolvedValue({
      id: 7,
      lastSentAt: prevDate,
      cooldownMinutes: 5,
      enabled: true,
    });
    sendMessage.mockRejectedValue(new Error('telegram down'));

    await processWhaleBuyAlert(baseParams);

    expect(mockPrisma.notificationSetting.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notificationSetting.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastSentAt: prevDate },
    });
    expect(mockPrisma.alertHistory.create).not.toHaveBeenCalled();
  });

  it('does not send or claim when another process already claimed the cooldown', async () => {
    mockPrisma.notificationSetting.updateMany.mockResolvedValue({ count: 0 });
    await processWhaleBuyAlert(baseParams);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mockPrisma.alertHistory.create).not.toHaveBeenCalled();
  });

  it('does not claim the cooldown when no bot is initialized', async () => {
    initAlertEngine(null as any);
    await processWhaleBuyAlert(baseParams);
    expect(mockPrisma.notificationSetting.updateMany).not.toHaveBeenCalled();
  });

  it('skips entirely when the WHALE_BUY setting is disabled/missing', async () => {
    mockPrisma.notificationSetting.findFirst.mockResolvedValue(null);
    await processWhaleBuyAlert(baseParams);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
