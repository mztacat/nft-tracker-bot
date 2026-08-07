import { getNftTransfersSince } from '../services/providers/transfers';

jest.mock('../config/index', () => ({
  config: { ALCHEMY_API_KEY: 'test-key', LOG_LEVEL: 'silent', NODE_ENV: 'test' },
}));

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function rpcResponse(result: any) {
  return {
    ok: true,
    json: async () => ({ jsonrpc: '2.0', id: 1, result }),
  } as any;
}

function transferEntry(overrides: Record<string, any> = {}) {
  return {
    hash: '0xtx',
    blockNum: '0x64', // 100
    from: '0xseller',
    to: '0xbuyer',
    tokenId: '1',
    metadata: { blockTimestamp: '2026-08-07T12:00:00Z' },
    ...overrides,
  };
}

describe('getNftTransfersSince', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('returns complete=true when pagination finishes', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(rpcResponse({ transfers: [transferEntry()] }));

    const res = await getNftTransfersSince('0xcontract', 100);
    expect(res.complete).toBe(true);
    expect(res.transfers).toHaveLength(1);
    expect(res.transfers[0].blockNum).toBe(100);
  });

  it('returns complete=false on RPC failure so the cursor is not advanced', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const res = await getNftTransfersSince('0xcontract', 100);
    expect(res.complete).toBe(false);
    expect(res.transfers).toHaveLength(0);
  });

  it('returns complete=false on non-OK HTTP response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 } as any);

    const res = await getNftTransfersSince('0xcontract', 100);
    expect(res.complete).toBe(false);
  });

  it('returns complete=false when pageKey persists past maxPages (pagination overflow)', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      rpcResponse({ transfers: [transferEntry()], pageKey: 'more' })
    );

    const res = await getNftTransfersSince('0xcontract', 100, 'ethereum', 2);
    expect(res.complete).toBe(false);
    expect(res.transfers).toHaveLength(2); // one per page fetched
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('marks partial results incomplete when a later page fails mid-pagination', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(rpcResponse({ transfers: [transferEntry()], pageKey: 'p2' }))
      .mockRejectedValueOnce(new Error('boom'));

    const res = await getNftTransfersSince('0xcontract', 100);
    expect(res.complete).toBe(false);
    expect(res.transfers).toHaveLength(1);
  });

  it('sums ERC1155 batch amounts', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      rpcResponse({
        transfers: [
          transferEntry({
            tokenId: undefined,
            erc1155Metadata: [
              { tokenId: '5', value: '0x2' },
              { tokenId: '6', value: '0x3' },
            ],
          }),
        ],
      })
    );

    const res = await getNftTransfersSince('0xcontract', 100);
    expect(res.transfers[0].amount).toBe(5);
    expect(res.transfers[0].tokenId).toBe('5');
  });
});
