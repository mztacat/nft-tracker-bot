import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

const CHAIN_HOSTS: Record<string, string> = {
  ethereum: 'eth-mainnet.g.alchemy.com',
  polygon:  'polygon-mainnet.g.alchemy.com',
  arbitrum: 'arb-mainnet.g.alchemy.com',
  optimism: 'opt-mainnet.g.alchemy.com',
  base:     'base-mainnet.g.alchemy.com',
};

function rpcUrl(chain = 'ethereum'): string | null {
  const key = config.ALCHEMY_API_KEY;
  if (!key) return null;
  const host = CHAIN_HOSTS[chain] ?? CHAIN_HOSTS['ethereum'];
  return `https://${host}/v2/${key}`;
}

async function rpcCall<T>(chain: string, method: string, params: unknown[]): Promise<T | null> {
  const url = rpcUrl(chain);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) {
      logger.warn({ method, status: res.status }, 'Alchemy RPC non-OK response');
      return null;
    }
    const json: any = await res.json();
    if (json.error) {
      logger.warn({ method, error: json.error }, 'Alchemy RPC error');
      return null;
    }
    return json.result as T;
  } catch (err) {
    logger.error({ err, method }, 'Alchemy RPC fetch error');
    return null;
  }
}

export interface NftTransfer {
  /** Stable per-transfer identity (Alchemy uniqueId: "<txHash>:log:<index>"). */
  uniqueId: string;
  txHash: string;
  blockNum: number;
  from: string;
  to: string;
  tokenId: string | null;
  amount: number; // number of NFTs moved in this transfer entry (ERC1155 can be >1)
  timestamp: Date | null;
}

export async function getLatestBlockNumber(chain = 'ethereum'): Promise<number | null> {
  const hex = await rpcCall<string>(chain, 'eth_blockNumber', []);
  return hex ? parseInt(hex, 16) : null;
}

export interface TransfersResult {
  transfers: NftTransfer[];
  /**
   * True only when every page was fetched successfully and pagination
   * finished. When false, callers must NOT advance their block cursor past
   * the last transfer actually received, or events will be lost.
   */
  complete: boolean;
}

/**
 * Fetch ERC721/ERC1155 transfers for a contract from a given block (inclusive)
 * using alchemy_getAssetTransfers. Paginates up to `maxPages` pages.
 */
export async function getNftTransfersSince(
  contractAddress: string,
  fromBlock: number,
  chain = 'ethereum',
  maxPages = 3
): Promise<TransfersResult> {
  const transfers: NftTransfer[] = [];
  let pageKey: string | undefined;
  let complete = false;

  for (let page = 0; page < maxPages; page++) {
    const result = await rpcCall<any>(chain, 'alchemy_getAssetTransfers', [
      {
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: 'latest',
        contractAddresses: [contractAddress],
        category: ['erc721', 'erc1155'],
        withMetadata: true,
        excludeZeroValue: false,
        order: 'asc',
        maxCount: '0x3e8', // 1000
        ...(pageKey ? { pageKey } : {}),
      },
    ]);
    if (!result) break;

    for (const t of result.transfers ?? []) {
      const erc1155Entries: any[] = t.erc1155Metadata ?? [];
      const amount = erc1155Entries.length
        ? erc1155Entries.reduce((s, e) => s + (parseInt(e.value ?? '0x1', 16) || 1), 0)
        : 1;
      const tokenKey = t.tokenId ?? erc1155Entries[0]?.tokenId ?? '';
      transfers.push({
        uniqueId: t.uniqueId ?? `${t.hash}:${tokenKey}:${t.blockNum}`,
        txHash: t.hash,
        blockNum: parseInt(t.blockNum, 16),
        from: (t.from ?? '').toLowerCase(),
        to: (t.to ?? '').toLowerCase(),
        tokenId: t.tokenId ?? erc1155Entries[0]?.tokenId ?? null,
        amount,
        timestamp: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp) : null,
      });
    }

    pageKey = result.pageKey;
    if (!pageKey) {
      complete = true;
      break;
    }
  }

  return { transfers, complete };
}

/**
 * Fetch the ETH value (in ETH) sent in each transaction. Used to approximate
 * the amount a buyer spent. Works for direct marketplace buys; aggregator
 * buys route value through the router tx which is still captured here.
 */
export async function getTxEthValues(
  txHashes: string[],
  chain = 'ethereum'
): Promise<Map<string, number>> {
  const values = new Map<string, number>();
  const unique = [...new Set(txHashes)].slice(0, 20); // cap RPC calls per tick

  for (const hash of unique) {
    const tx = await rpcCall<any>(chain, 'eth_getTransactionByHash', [hash]);
    if (tx?.value) {
      values.set(hash, parseInt(tx.value, 16) / 1e18);
    }
  }

  return values;
}

/**
 * NFT transfers involving a wallet (both directions) since fromBlock.
 * Used by the wallet-tracking worker.
 */
export interface WalletNftTransfer extends NftTransfer {
  contractAddress: string;
}

export async function getWalletNftTransfers(
  wallet: string,
  fromBlock: number,
  chain = 'ethereum'
): Promise<WalletNftTransfer[]> {
  const common = {
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: 'latest',
    category: ['erc721', 'erc1155'],
    withMetadata: true,
    excludeZeroValue: false,
    order: 'asc',
    maxCount: '0x64',
  };
  const [incoming, outgoing] = await Promise.all([
    rpcCall<any>(chain, 'alchemy_getAssetTransfers', [{ ...common, toAddress: wallet }]),
    rpcCall<any>(chain, 'alchemy_getAssetTransfers', [{ ...common, fromAddress: wallet }]),
  ]);

  const map = (raw: any[]): WalletNftTransfer[] =>
    raw.map((t: any) => {
      const erc1155Entries: any[] = t.erc1155Metadata ?? [];
      const amount = erc1155Entries.length
        ? erc1155Entries.reduce((s, e) => s + (parseInt(e.value ?? '0x1', 16) || 1), 0)
        : 1;
      const tokenKey = t.tokenId ?? erc1155Entries[0]?.tokenId ?? '';
      return {
        uniqueId: t.uniqueId ?? `${t.hash}:${tokenKey}:${t.blockNum}`,
        txHash: t.hash,
        blockNum: parseInt(t.blockNum, 16),
        from: (t.from ?? '').toLowerCase(),
        to: (t.to ?? '').toLowerCase(),
        tokenId: t.tokenId ?? erc1155Entries[0]?.tokenId ?? null,
        amount,
        timestamp: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp) : null,
        contractAddress: (t.rawContract?.address ?? '').toLowerCase(),
      };
    });

  const all = [
    ...map(incoming?.transfers ?? []),
    ...map(outgoing?.transfers ?? []),
  ];
  const seen = new Set<string>();
  return all.filter((t) => {
    const k = `${t.txHash}:${t.tokenId}:${t.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface WalletCollectionTx {
  txHash: string;
  tokenId: string | null;
  direction: 'buy' | 'sell' | 'transfer';
  ethValue: number; // 0 when unknown / mint / transfer
  timestamp: Date | null;
}

/**
 * Full transfer history for a wallet in one specific collection (contract).
 * Returns up to `maxEntries` transactions, newest-first.
 */
export async function getWalletCollectionHistory(
  wallet: string,
  contractAddress: string,
  chain = 'ethereum',
  maxEntries = 200
): Promise<WalletCollectionTx[]> {
  const maxHex = '0x' + Math.min(maxEntries, 1000).toString(16);
  const common = {
    fromBlock: '0x0',
    toBlock: 'latest',
    contractAddresses: [contractAddress],
    category: ['erc721', 'erc1155'],
    withMetadata: true,
    excludeZeroValue: false,
    order: 'desc',
    maxCount: maxHex,
  };

  const [incoming, outgoing] = await Promise.all([
    rpcCall<any>(chain, 'alchemy_getAssetTransfers', [{ ...common, toAddress: wallet }]),
    rpcCall<any>(chain, 'alchemy_getAssetTransfers', [{ ...common, fromAddress: wallet }]),
  ]);

  const walletLower = wallet.toLowerCase();
  const contractLower = contractAddress.toLowerCase();

  const raw: Array<{ t: any; direction: 'buy' | 'sell' | 'transfer' }> = [
    ...(incoming?.transfers ?? []).map((t: any) => ({
      t,
      direction: (t.from?.toLowerCase() === '0x0000000000000000000000000000000000000000'
        ? 'buy' // mint — treat as buy
        : 'buy') as 'buy',
    })),
    ...(outgoing?.transfers ?? []).map((t: any) => ({
      t,
      direction: (t.to?.toLowerCase() === '0x0000000000000000000000000000000000000000'
        ? 'sell'
        : 'sell') as 'sell',
    })),
  ];

  // Deduplicate by txHash + tokenId + direction
  const seen = new Set<string>();
  const deduped = raw.filter(({ t, direction }) => {
    const erc1155Entries: any[] = t.erc1155Metadata ?? [];
    const tokenKey = t.tokenId ?? erc1155Entries[0]?.tokenId ?? '';
    const k = `${t.hash}:${tokenKey}:${direction}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort newest first
  deduped.sort((a, b) => {
    const ta = a.t.metadata?.blockTimestamp ? new Date(a.t.metadata.blockTimestamp).getTime() : 0;
    const tb = b.t.metadata?.blockTimestamp ? new Date(b.t.metadata.blockTimestamp).getTime() : 0;
    return tb - ta;
  });

  const sliced = deduped.slice(0, maxEntries);

  // Fetch ETH values for all unique tx hashes (buys typically have value)
  const uniqueHashes = [...new Set(sliced.map(({ t }) => t.hash as string))];
  const ethValues = await getTxEthValues(uniqueHashes.slice(0, 20), chain);

  return sliced.map(({ t, direction }) => {
    const erc1155Entries: any[] = t.erc1155Metadata ?? [];
    const tokenId: string | null = t.tokenId ?? erc1155Entries[0]?.tokenId ?? null;
    return {
      txHash: t.hash,
      tokenId: tokenId ? BigInt(tokenId).toString() : null,
      direction,
      ethValue: ethValues.get(t.hash) ?? 0,
      timestamp: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp) : null,
    };
  });
}
