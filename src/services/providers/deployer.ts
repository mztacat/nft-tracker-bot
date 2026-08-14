import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

const CHAIN_HOSTS: Record<string, string> = {
  ethereum: 'eth-mainnet.g.alchemy.com',
  polygon:  'polygon-mainnet.g.alchemy.com',
  arbitrum: 'arb-mainnet.g.alchemy.com',
  optimism: 'opt-mainnet.g.alchemy.com',
  base:     'base-mainnet.g.alchemy.com',
};

function host(chain: string): string {
  return CHAIN_HOSTS[chain] ?? CHAIN_HOSTS['ethereum'];
}

async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T | null> {
  const key = config.ALCHEMY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://${host(chain)}/v2/${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json.error) {
      logger.warn({ method, error: json.error }, 'deployer rpc error');
      return null;
    }
    return json.result as T;
  } catch (err) {
    logger.error({ err, method }, 'deployer rpc fetch error');
    return null;
  }
}

/** Who deployed this contract? (Alchemy NFT API v3 getContractMetadata) */
export async function getContractDeployer(contractAddress: string, chain = 'ethereum'): Promise<string | null> {
  const key = config.ALCHEMY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://${host(chain)}/nft/v3/${key}/getContractMetadata?contractAddress=${contractAddress}`
    );
    if (!res.ok) return null;
    const meta: any = await res.json();
    return meta?.contractDeployer?.toLowerCase() ?? null;
  } catch (err) {
    logger.error({ err, contractAddress }, 'getContractDeployer failed');
    return null;
  }
}

export interface NewDeployment {
  contractAddress: string;
  txHash: string;
  blockNum: number;
  kind: 'NFT (ERC721)' | 'NFT (ERC1155)' | 'Token (ERC20)' | 'Contract';
  name: string | null;
  symbol: string | null;
}

/**
 * Find contract creations by a wallet since fromBlock: external txs with no
 * `to` address, confirmed via receipt.contractAddress, then classified.
 */
export async function getNewDeployments(
  deployer: string,
  fromBlock: number,
  chain = 'ethereum'
): Promise<NewDeployment[]> {
  const result = await rpc<any>(chain, 'alchemy_getAssetTransfers', [
    {
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: 'latest',
      fromAddress: deployer,
      category: ['external'],
      excludeZeroValue: false,
      maxCount: '0x32',
    },
  ]);

  const creations = (result?.transfers ?? []).filter((t: any) => t.to == null);
  const deployments: NewDeployment[] = [];

  for (const t of creations.slice(0, 5)) {
    const receipt = await rpc<any>(chain, 'eth_getTransactionReceipt', [t.hash]);
    const contractAddress: string | null = receipt?.contractAddress ?? null;
    if (!contractAddress) continue;

    deployments.push({
      contractAddress: contractAddress.toLowerCase(),
      txHash: t.hash,
      blockNum: parseInt(t.blockNum, 16),
      ...(await classifyContract(contractAddress, chain)),
    });
  }
  return deployments;
}

async function classifyContract(
  contractAddress: string,
  chain: string
): Promise<{ kind: NewDeployment['kind']; name: string | null; symbol: string | null }> {
  const key = config.ALCHEMY_API_KEY!;

  // NFT?
  try {
    const res = await fetch(
      `https://${host(chain)}/nft/v3/${key}/getContractMetadata?contractAddress=${contractAddress}`
    );
    if (res.ok) {
      const meta: any = await res.json();
      if (meta?.tokenType === 'ERC721' || meta?.tokenType === 'ERC1155') {
        return {
          kind: meta.tokenType === 'ERC721' ? 'NFT (ERC721)' : 'NFT (ERC1155)',
          name: meta?.name ?? null,
          symbol: meta?.symbol ?? null,
        };
      }
    }
  } catch {}

  // ERC20?
  const tokenMeta = await rpc<any>(chain, 'alchemy_getTokenMetadata', [contractAddress]);
  if (tokenMeta?.symbol || tokenMeta?.decimals != null) {
    return { kind: 'Token (ERC20)', name: tokenMeta?.name ?? null, symbol: tokenMeta?.symbol ?? null };
  }

  return { kind: 'Contract', name: null, symbol: null };
}
