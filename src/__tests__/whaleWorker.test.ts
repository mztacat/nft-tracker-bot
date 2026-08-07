/**
 * Worker-level tests with a stateful in-memory MarketEvent store:
 * - two chats tracking the same collection must BOTH receive whale alerts
 * - a buyer's activity split by pagination across ticks must still aggregate
 *   to threshold (rolling aggregation over unprocessed in-window transfers)
 * - transfers are marked processed only after a successful send
 */
jest.mock('../db/client', () => ({
  prisma: {
    trackedItem: { findMany: jest.fn(), update: jest.fn() },
    settings: { findUnique: jest.fn(), upsert: jest.fn() },
    marketEvent: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
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

// ─── In-memory MarketEvent store ────────────────────────────────────────────
let eventStore: any[] = [];
let nextId = 1;

function installStatefulMarketEventMock() {
  mockPrisma.marketEvent.findMany.mockImplementation(({ where }: any) => {
    let rows = eventStore.filter((r) => r.assetId === where.assetId && r.eventType === where.eventType);
    if (where.txHash?.in) rows = rows.filter((r) => where.txHash.in.includes(r.txHash));
    if (where.processed !== undefined) rows = rows.filter((r) => r.processed === where.processed);
    if (where.timestamp?.gte) rows = rows.filter((r) => r.timestamp >= where.timestamp.gte);
    return Promise.resolve(rows);
  });
  mockPrisma.marketEvent.createMany.mockImplementation(({ data }: any) => {
    for (const d of data) eventStore.push({ id: nextId++, ...d });
    return Promise.resolve({ count: data.length });
  });
  mockPrisma.marketEvent.create.mockImplementation(({ data }: any) => {
    const row = { id: nextId++, ...data };
    eventStore.push(row);
    return Promise.resolve(row);
  });
  mockPrisma.marketEvent.updateMany.mockImplementation(({ where, data }: any) => {
    let count = 0;
    for (const r of eventStore) {
      if (where.id?.in?.includes(r.id)) {
        Object.assign(r, data);
        count++;
      }
    }
    return Promise.resolve({ count });
  });
}

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

function transfer(uniqueId: string, txHash: string, tokenId: string, blockNum = 200) {
  return {
    uniqueId,
    txHash,
    blockNum,
    from: '0xseller',
    to: '0xwhale',
    tokenId,
    amount: 1,
    timestamp: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  eventStore = [];
  nextId = 1;
  installStatefulMarketEventMock();
  mockPrisma.settings.findUnique.mockResolvedValue({ value: '150' });
  mockPrisma.settings.upsert.mockResolvedValue({});
  (getLatestBlockNumber as jest.Mock).mockResolvedValue(210);
  (processWhaleBuyAlert as jest.Mock).mockResolvedValue(true); // send succeeds
});

describe('two chats tracking one collection', () => {
  beforeEach(() => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem(1, 'chatA'), makeItem(2, 'chatB')]);
    (getNftTransfersSince as jest.Mock).mockResolvedValue({
      transfers: [1, 2, 3].map((i) => transfer(`0xsweep:log:${i}`, '0xsweep', String(i))),
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

  it('scopes ingestion and processing per tracked item', async () => {
    await runWhaleWorker();
    const scopes = [...new Set(eventStore.map((r) => r.assetId))].sort();
    expect(scopes).toEqual(['item:1', 'item:2']);
    // both items' TRANSFER rows marked processed after successful sends
    const unprocessed = eventStore.filter((r) => r.eventType === 'TRANSFER' && !r.processed);
    expect(unprocessed).toHaveLength(0);
  });
});

describe('pagination splitting a buyer across ticks (rolling aggregation)', () => {
  beforeEach(() => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem(1, 'chatA')]);
  });

  it('sweep sub-threshold on tick 1 qualifies after tick 2 continuation, alerting once', async () => {
    // Tick 1: incomplete fetch returns only 2 of 4 sweep transfers (below minItems=3)
    (getNftTransfersSince as jest.Mock).mockResolvedValueOnce({
      transfers: [transfer('0xs:log:1', '0xs', '1'), transfer('0xs:log:2', '0xs', '2')],
      complete: false,
    });
    (getTxEthValues as jest.Mock).mockResolvedValue(new Map([['0xs', 0.5], ['0xs2', 0.5]]));
    await runWhaleWorker();
    expect(processWhaleBuyAlert).not.toHaveBeenCalled();
    expect(eventStore.filter((r) => r.eventType === 'TRANSFER' && !r.processed)).toHaveLength(2);

    // Tick 2: boundary block re-fetched in full — overlap plus the missed transfers
    (getNftTransfersSince as jest.Mock).mockResolvedValueOnce({
      transfers: [
        transfer('0xs:log:1', '0xs', '1'),
        transfer('0xs:log:2', '0xs', '2'),
        transfer('0xs2:log:1', '0xs2', '3'),
        transfer('0xs2:log:2', '0xs2', '4'),
      ],
      complete: true,
    });
    await runWhaleWorker();

    // Aggregate of 4 items now crosses minItems=3 → exactly one alert
    expect(processWhaleBuyAlert).toHaveBeenCalledTimes(1);
    const call = (processWhaleBuyAlert as jest.Mock).mock.calls[0][0];
    expect(call.itemCount).toBe(4);
    expect(call.isSweep).toBe(true);
    // no duplicate TRANSFER rows despite the overlap re-fetch
    expect(eventStore.filter((r) => r.eventType === 'TRANSFER')).toHaveLength(4);
  });

  it('ETH spend split across pages aggregates to the whale threshold', async () => {
    // Tick 1: 3 ETH buy (below minEth=5)
    (getNftTransfersSince as jest.Mock).mockResolvedValueOnce({
      transfers: [transfer('0xa:log:1', '0xa', '1')],
      complete: false,
    });
    (getTxEthValues as jest.Mock).mockResolvedValue(new Map([['0xa', 3], ['0xb', 2]]));
    await runWhaleWorker();
    expect(processWhaleBuyAlert).not.toHaveBeenCalled();

    // Tick 2: continuation brings a 2 ETH buy by the same wallet → 5 ETH total
    (getNftTransfersSince as jest.Mock).mockResolvedValueOnce({
      transfers: [transfer('0xb:log:1', '0xb', '2')],
      complete: true,
    });
    await runWhaleWorker();

    expect(processWhaleBuyAlert).toHaveBeenCalledTimes(1);
    expect((processWhaleBuyAlert as jest.Mock).mock.calls[0][0].ethSpent).toBe(5);
  });

  it('keeps transfers pending when the send fails, so nothing is lost', async () => {
    (processWhaleBuyAlert as jest.Mock).mockResolvedValue(false); // send blocked/failed
    (getNftTransfersSince as jest.Mock).mockResolvedValue({
      transfers: [1, 2, 3].map((i) => transfer(`0xsw:log:${i}`, '0xsw', String(i))),
      complete: true,
    });
    (getTxEthValues as jest.Mock).mockResolvedValue(new Map([['0xsw', 6]]));

    await runWhaleWorker();

    expect(eventStore.filter((r) => r.eventType === 'TRANSFER' && !r.processed)).toHaveLength(3);
    expect(eventStore.filter((r) => r.eventType === 'WHALE_BUY')).toHaveLength(0);
  });
});
