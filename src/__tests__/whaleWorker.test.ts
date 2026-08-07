/**
 * Worker-level tests: two chats tracking the same collection must BOTH
 * receive whale alerts (dedupe is scoped per tracked item, not global).
 */
jest.mock('../db/client', () => ({
  prisma: {
    trackedItem: { findMany: jest.fn(), update: jest.fn() },
    settings: { findUnique: jest.fn(), upsert: jest.fn() },
    marketEvent: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../services/providers/index', () => ({
  getProvider: jest.fn(),
}));

jest.mock('../services/providers/transfers', () => ({
  getLatestBlockNumber: jest.fn(),
  getNftTransfersSince: jest.fn(),
  getTxEthValues: jest.fn(),
}));

jest.mock('../services/alerts/alert.engine', () => ({
  processWhaleBuyAlert: jest.fn(),
}));

import { prisma } from '../db/client';
import {
  getLatestBlockNumber,
  getNftTransfersSince,
  getTxEthValues,
} from '../services/providers/transfers';
import { processWhaleBuyAlert } from '../services/alerts/alert.engine';
import { runWhaleWorker } from '../workers/whaleWorker';

const mockPrisma = prisma as any;
const CONTRACT = '0xcontract';

function makeItem(id: number, chatId: string) {
  return {
    id,
    chain: 'ethereum',
    contractAddress: CONTRACT,
    collectionSlug: 'azuki',
    label: 'Azuki',
    chat: { telegramChatId: chatId },
    notificationSettings: [
      { eventType: 'WHALE_BUY', enabled: true, thresholdJson: { minItems: 3, minEth: 5 } },
    ],
  };
}

function sweepTransfers() {
  const now = new Date();
  return [1, 2, 3].map((i) => ({
    uniqueId: `0xsweep:log:${i}`,
    txHash: '0xsweep',
    blockNum: 200,
    from: '0xseller',
    to: '0xwhale',
    tokenId: String(i),
    amount: 1,
    timestamp: now,
  }));
}

describe('runWhaleWorker with two chats tracking one collection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.trackedItem.findMany.mockResolvedValue([
      makeItem(1, 'chatA'),
      makeItem(2, 'chatB'),
    ]);
    mockPrisma.settings.findUnique.mockResolvedValue({ value: '150' }); // cursor
    mockPrisma.settings.upsert.mockResolvedValue({});
    mockPrisma.marketEvent.findMany.mockResolvedValue([]); // nothing seen yet
    mockPrisma.marketEvent.createMany.mockResolvedValue({ count: 3 });
    (getLatestBlockNumber as jest.Mock).mockResolvedValue(210);
    (getNftTransfersSince as jest.Mock).mockResolvedValue({
      transfers: sweepTransfers(),
      complete: true,
    });
    (getTxEthValues as jest.Mock).mockResolvedValue(new Map([['0xsweep', 6]]));
  });

  it('alerts BOTH tracked items for the same sweep', async () => {
    await runWhaleWorker();

    expect(processWhaleBuyAlert).toHaveBeenCalledTimes(2);
    const calls = (processWhaleBuyAlert as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.telegramChatId).sort()).toEqual(['chatA', 'chatB']);
    expect(calls.every((c) => c.itemCount === 3 && c.isSweep)).toBe(true);
  });

  it('scopes market-event dedupe queries per tracked item', async () => {
    await runWhaleWorker();

    const scopes = mockPrisma.marketEvent.findMany.mock.calls.map(
      (c: any[]) => c[0].where.assetId
    );
    expect(scopes.sort()).toEqual(['item:1', 'item:2']);

    const created = mockPrisma.marketEvent.createMany.mock.calls.map(
      (c: any[]) => c[0].data[0].assetId
    );
    expect(created.sort()).toEqual(['item:1', 'item:2']);
  });

  it('suppresses only the item that already processed the transfers', async () => {
    // item 1 already recorded all three transfers; item 2 has not
    mockPrisma.marketEvent.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.assetId === 'item:1'
          ? [1, 2, 3].map((i) => ({ rawJson: { uniqueId: `0xsweep:log:${i}` } }))
          : []
      )
    );

    await runWhaleWorker();

    expect(processWhaleBuyAlert).toHaveBeenCalledTimes(1);
    expect((processWhaleBuyAlert as jest.Mock).mock.calls[0][0].telegramChatId).toBe('chatB');
  });
});
