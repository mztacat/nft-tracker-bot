import { detectWhaleBuys, filterBuys, groupByBuyer } from '../services/whale/whale.detector';
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
