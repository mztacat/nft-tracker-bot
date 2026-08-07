import { detectWhaleBuys, excludeSeenTxs, filterBuys, filterWithinWindow, groupByBuyer, nextCursor } from '../services/whale/whale.detector';
import type { NftTransfer } from '../services/providers/transfers';

const ZERO = '0x0000000000000000000000000000000000000000';

function tf(overrides: Partial<NftTransfer>): NftTransfer {
  return {
    txHash: '0xtx1',
    blockNum: 100,
    from: '0xseller',
    to: '0xbuyer',
    tokenId: '1',
    amount: 1,
    timestamp: new Date('2026-08-07T00:00:00Z'),
    ...overrides,
  };
}

const THRESHOLDS = { minItems: 3, minEth: 5 };

describe('filterBuys', () => {
  it('excludes mints, burns and self-transfers', () => {
    const transfers = [
      tf({ from: ZERO, txHash: '0xmint' }),                 // mint
      tf({ to: ZERO, txHash: '0xburn' }),                   // burn
      tf({ from: '0xsame', to: '0xsame', txHash: '0xself' }), // self
      tf({ txHash: '0xbuy' }),                              // real buy
    ];
    const buys = filterBuys(transfers);
    expect(buys).toHaveLength(1);
    expect(buys[0].txHash).toBe('0xbuy');
  });
});

describe('groupByBuyer', () => {
  it('groups transfers by receiving wallet', () => {
    const buys = [
      tf({ to: '0xa', txHash: '0x1' }),
      tf({ to: '0xa', txHash: '0x2' }),
      tf({ to: '0xb', txHash: '0x3' }),
    ];
    const groups = groupByBuyer(buys);
    expect(groups.get('0xa')).toHaveLength(2);
    expect(groups.get('0xb')).toHaveLength(1);
  });
});

describe('detectWhaleBuys', () => {
  it('flags a sweep when one wallet buys >= minItems with real spend', () => {
    const transfers = [
      tf({ tokenId: '1', txHash: '0x1' }),
      tf({ tokenId: '2', txHash: '0x2' }),
      tf({ tokenId: '3', txHash: '0x3' }),
    ];
    const values = new Map([['0x1', 1], ['0x2', 1], ['0x3', 1]]);
    const res = detectWhaleBuys(transfers, THRESHOLDS, values);
    expect(res).toHaveLength(1);
    expect(res[0].isSweep).toBe(true);
    expect(res[0].itemCount).toBe(3);
    expect(res[0].ethSpent).toBe(3);
  });

  it('flags a whale spend even below the item threshold', () => {
    const transfers = [tf({ txHash: '0xbig' })];
    const values = new Map([['0xbig', 12.5]]);
    const res = detectWhaleBuys(transfers, THRESHOLDS, values);
    expect(res).toHaveLength(1);
    expect(res[0].isSweep).toBe(false);
    expect(res[0].ethSpent).toBe(12.5);
  });

  it('ignores small buys below both thresholds', () => {
    const transfers = [tf({ txHash: '0x1' }), tf({ txHash: '0x2', tokenId: '2' })];
    const values = new Map([['0x1', 0.5], ['0x2', 0.5]]);
    expect(detectWhaleBuys(transfers, THRESHOLDS, values)).toHaveLength(0);
  });

  it('skips zero-spend groups just over the item threshold (airdrop guard)', () => {
    const transfers = [
      tf({ tokenId: '1', txHash: '0xa' }),
      tf({ tokenId: '2', txHash: '0xa' }),
      tf({ tokenId: '3', txHash: '0xa' }),
    ];
    expect(detectWhaleBuys(transfers, THRESHOLDS, new Map())).toHaveLength(0);
  });

  it('still flags zero-spend groups at >= 2x threshold (aggregator spend can be invisible)', () => {
    const transfers = Array.from({ length: 6 }, (_, i) =>
      tf({ tokenId: String(i), txHash: `0x${i}` })
    );
    const res = detectWhaleBuys(transfers, THRESHOLDS, new Map());
    expect(res).toHaveLength(1);
    expect(res[0].itemCount).toBe(6);
  });

  it('counts ERC1155 amounts toward the item threshold', () => {
    const transfers = [tf({ amount: 4, txHash: '0xbatch' })];
    const values = new Map([['0xbatch', 2]]);
    const res = detectWhaleBuys(transfers, THRESHOLDS, values);
    expect(res).toHaveLength(1);
    expect(res[0].itemCount).toBe(4);
    expect(res[0].isSweep).toBe(true);
  });

  it('deduplicates tx hashes when summing spend', () => {
    const transfers = [
      tf({ tokenId: '1', txHash: '0xsame' }),
      tf({ tokenId: '2', txHash: '0xsame' }),
      tf({ tokenId: '3', txHash: '0xsame' }),
    ];
    const values = new Map([['0xsame', 6]]);
    const res = detectWhaleBuys(transfers, THRESHOLDS, values);
    expect(res).toHaveLength(1);
    expect(res[0].ethSpent).toBe(6);
    expect(res[0].txHashes).toEqual(['0xsame']);
  });
});

describe('filterWithinWindow', () => {
  const now = new Date('2026-08-07T12:00:00Z');

  it('keeps transfers inside the window and drops older ones', () => {
    const transfers = [
      tf({ txHash: '0xrecent', timestamp: new Date('2026-08-07T11:55:00Z') }),
      tf({ txHash: '0xold', timestamp: new Date('2026-08-07T11:30:00Z') }),
    ];
    const res = filterWithinWindow(transfers, 10, now);
    expect(res).toHaveLength(1);
    expect(res[0].txHash).toBe('0xrecent');
  });

  it('excludes transfers without a timestamp', () => {
    const transfers = [tf({ txHash: '0xnots', timestamp: null })];
    expect(filterWithinWindow(transfers, 10, now)).toHaveLength(0);
  });

  it('drops all stale transfers after a delayed catch-up scan', () => {
    const transfers = Array.from({ length: 5 }, (_, i) =>
      tf({ txHash: `0x${i}`, timestamp: new Date('2026-08-07T09:00:00Z') })
    );
    expect(filterWithinWindow(transfers, 10, now)).toHaveLength(0);
  });
});

describe('nextCursor', () => {
  it('jumps to chain head on a complete fetch', () => {
    expect(nextCursor({ complete: true, latestBlock: 500, transfers: [], prevCursor: 100 })).toBe(500);
  });

  it('keeps the previous cursor when an incomplete fetch returned nothing (RPC failure)', () => {
    expect(nextCursor({ complete: false, latestBlock: 500, transfers: [], prevCursor: 100 })).toBe(100);
  });

  it('resumes from before the boundary block when pagination overflowed (block may be bisected)', () => {
    const transfers = [tf({ blockNum: 150 }), tf({ blockNum: 180 })];
    // cursor 179 → next fetch starts at 180, re-fetching the boundary block in full
    expect(nextCursor({ complete: false, latestBlock: 500, transfers, prevCursor: 100 })).toBe(179);
  });

  it('never moves the cursor backwards', () => {
    const transfers = [tf({ blockNum: 90 })];
    expect(nextCursor({ complete: false, latestBlock: 500, transfers, prevCursor: 100 })).toBe(100);
  });
});

describe('pagination boundary bisecting a block (two-tick integration)', () => {
  it('detects every transfer exactly once across ticks with overlap + dedupe', () => {
    // Block 180 contains 3 transfers; tick 1's pagination cap bisects it
    const all = [
      tf({ txHash: '0xa', blockNum: 170, tokenId: '1', timestamp: new Date() }),
      tf({ txHash: '0xb', blockNum: 180, tokenId: '2', timestamp: new Date() }),
      tf({ txHash: '0xc', blockNum: 180, tokenId: '3', timestamp: new Date() }),
      tf({ txHash: '0xd', blockNum: 180, tokenId: '4', timestamp: new Date() }),
    ];

    // Tick 1: incomplete fetch received only part of block 180
    const tick1 = all.slice(0, 2); // 0xa (block 170), 0xb (block 180 partial)
    const cursor1 = nextCursor({ complete: false, latestBlock: 500, transfers: tick1, prevCursor: 100 });
    expect(cursor1).toBe(179); // resume from block 180 next tick

    const seen = new Set<string>();
    const fresh1 = excludeSeenTxs(tick1, seen);
    expect(fresh1.map((t) => t.txHash)).toEqual(['0xa', '0xb']);
    fresh1.forEach((t) => seen.add(t.txHash)); // recorded as market events

    // Tick 2: fetch from cursor1 + 1 = block 180, complete — returns ALL of block 180
    const tick2 = all.filter((t) => t.blockNum >= cursor1 + 1);
    expect(tick2.map((t) => t.txHash)).toEqual(['0xb', '0xc', '0xd']);

    const fresh2 = excludeSeenTxs(tick2, seen);
    // 0xb was already processed in tick 1 — only the missed transfers surface
    expect(fresh2.map((t) => t.txHash)).toEqual(['0xc', '0xd']);
    fresh2.forEach((t) => seen.add(t.txHash));

    // Every transfer processed exactly once
    expect(seen.size).toBe(4);
    const cursor2 = nextCursor({ complete: true, latestBlock: 500, transfers: tick2, prevCursor: cursor1 });
    expect(cursor2).toBe(500);
  });
});
