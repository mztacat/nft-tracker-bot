/**
 * Holder worker tests:
 * - snapshots holder count + top-10 balances every tick
 * - alerts on >threshold unique-holder change vs a ~24h-old baseline
 * - alerts when a top-10 holder cuts position or leaves the top 10
 * - no baseline (fresh item) → snapshot only, no count alert
 */
jest.mock('../db/client', () => ({
  prisma: {
    trackedItem: { findMany: jest.fn() },
    collectionSnapshot: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../services/providers/index', () => ({
  getProvider: jest.fn(),
}));

jest.mock('../services/alerts/alert.engine', () => ({
  processGenericAlert: jest.fn(),
}));

import { prisma } from '../db/client';
import { getProvider } from '../services/providers/index';
import { processGenericAlert } from '../services/alerts/alert.engine';
import { runHolderWorker } from '../workers/holderWorker';

const mockPrisma = prisma as any;
const mockGetProvider = getProvider as jest.Mock;
const mockAlert = processGenericAlert as jest.Mock;

const HOUR = 60 * 60 * 1000;

function makeItem(overrides: any = {}) {
  return {
    id: 1,
    type: 'COLLECTION',
    contractAddress: '0xcontract',
    chain: 'ethereum',
    label: 'Test Collection',
    collectionSlug: 'test',
    chat: { telegramChatId: '111' },
    notificationSettings: [
      { eventType: 'HOLDER_COUNT_CHANGE', enabled: true, thresholdJson: null },
      { eventType: 'TOP_HOLDER_CHANGE', enabled: true, thresholdJson: null },
    ],
    ...overrides,
  };
}

function installSnapshotMock(rows: any[]) {
  mockPrisma.collectionSnapshot.findFirst.mockImplementation(({ where }: any) => {
    let candidates = rows.filter((r) => r.trackedItemId === where.trackedItemId);
    if (where.holdersCount) candidates = candidates.filter((r) => r.holdersCount != null);
    if (where.topHoldersJson) candidates = candidates.filter((r) => r.topHoldersJson != null);
    if (where.timestamp?.lte) candidates = candidates.filter((r) => r.timestamp <= where.timestamp.lte);
    if (where.timestamp?.gte) candidates = candidates.filter((r) => r.timestamp >= where.timestamp.gte);
    candidates.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return Promise.resolve(candidates[0] ?? null);
  });
  mockPrisma.collectionSnapshot.create.mockResolvedValue({});
}

function providerReturning(data: any) {
  mockGetProvider.mockReturnValue({ getCollectionHolders: jest.fn().mockResolvedValue(data) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAlert.mockResolvedValue(true);
});

describe('holderWorker', () => {
  it('snapshots holder count and top-10 balances every tick', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem()]);
    installSnapshotMock([]);
    providerReturning({
      uniqueHolders: 1000,
      totalSupply: 5000,
      topHolders: [{ address: '0xa', balance: 100, percentage: 2 }],
    });

    await runHolderWorker();

    expect(mockPrisma.collectionSnapshot.create).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.collectionSnapshot.create.mock.calls[0][0].data;
    expect(arg.holdersCount).toBe(1000);
    expect(arg.topHoldersJson).toEqual([{ address: '0xa', balance: 100, percentage: 2 }]);
    // Fresh item: no baseline, no alert
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('alerts on >2% holder-count drop vs ~24h-old baseline', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem()]);
    installSnapshotMock([
      { trackedItemId: 1, timestamp: new Date(Date.now() - 24 * HOUR), holdersCount: 1000, topHoldersJson: null },
    ]);
    providerReturning({ uniqueHolders: 950, topHolders: [] });

    await runHolderWorker();

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const call = mockAlert.mock.calls[0][0];
    expect(call.eventType).toBe('HOLDER_COUNT_CHANGE');
    expect(call.message).toContain('-50');
    expect(call.message).toContain('exiting');
  });

  it('does not alert on sub-threshold holder-count change', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem()]);
    installSnapshotMock([
      { trackedItemId: 1, timestamp: new Date(Date.now() - 24 * HOUR), holdersCount: 1000, topHoldersJson: null },
    ]);
    providerReturning({ uniqueHolders: 990, topHolders: [] }); // 1% < 2%

    await runHolderWorker();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('ignores a recent snapshot (<20h) as a 24h baseline', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem()]);
    installSnapshotMock([
      { trackedItemId: 1, timestamp: new Date(Date.now() - 1 * HOUR), holdersCount: 1000, topHoldersJson: null },
    ]);
    providerReturning({ uniqueHolders: 900, topHolders: [] });

    await runHolderWorker();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('alerts when a top-10 holder cuts position by >=10%', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem()]);
    installSnapshotMock([
      {
        trackedItemId: 1,
        timestamp: new Date(Date.now() - 1 * HOUR),
        holdersCount: 1000,
        topHoldersJson: [
          { address: '0xAAA', balance: 100 },
          { address: '0xBBB', balance: 50 },
        ],
      },
    ]);
    providerReturning({
      uniqueHolders: 1000,
      topHolders: [
        { address: '0xaaa', balance: 60 }, // -40%, case-insensitive match
        { address: '0xbbb', balance: 50 },
      ],
    });

    await runHolderWorker();

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const call = mockAlert.mock.calls[0][0];
    expect(call.eventType).toBe('TOP_HOLDER_CHANGE');
    expect(call.message).toContain('100 → 60');
  });

  it('alerts when a previous top-10 holder disappears from the top 10', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem()]);
    installSnapshotMock([
      {
        trackedItemId: 1,
        timestamp: new Date(Date.now() - 1 * HOUR),
        holdersCount: 1000,
        topHoldersJson: [{ address: '0xgone', balance: 80 }],
      },
    ]);
    providerReturning({
      uniqueHolders: 1000,
      topHolders: [{ address: '0xother', balance: 10 }],
    });

    await runHolderWorker();

    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0].message).toContain('left the top 10');
  });

  it('does not alert on small (<10%) top-holder reductions', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([makeItem()]);
    installSnapshotMock([
      {
        trackedItemId: 1,
        timestamp: new Date(Date.now() - 1 * HOUR),
        holdersCount: 1000,
        topHoldersJson: [{ address: '0xaaa', balance: 100 }],
      },
    ]);
    providerReturning({
      uniqueHolders: 1000,
      topHolders: [{ address: '0xaaa', balance: 95 }], // -5%
    });

    await runHolderWorker();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('respects disabled notification settings', async () => {
    mockPrisma.trackedItem.findMany.mockResolvedValue([
      makeItem({
        notificationSettings: [
          { eventType: 'HOLDER_COUNT_CHANGE', enabled: false },
          { eventType: 'TOP_HOLDER_CHANGE', enabled: false },
        ],
      }),
    ]);
    installSnapshotMock([
      {
        trackedItemId: 1,
        timestamp: new Date(Date.now() - 24 * HOUR),
        holdersCount: 1000,
        topHoldersJson: [{ address: '0xaaa', balance: 100 }],
      },
    ]);
    providerReturning({ uniqueHolders: 800, topHolders: [{ address: '0xaaa', balance: 10 }] });

    await runHolderWorker();
    expect(mockAlert).not.toHaveBeenCalled();
    // Snapshot still written
    expect(mockPrisma.collectionSnapshot.create).toHaveBeenCalledTimes(1);
  });
});
