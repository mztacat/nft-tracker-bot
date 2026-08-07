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
      transfers.push({
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
      return {
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
