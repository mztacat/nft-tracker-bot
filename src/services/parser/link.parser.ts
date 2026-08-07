export type ParsedLink =
  | {
      type: 'collection';
      marketplace: 'opensea' | 'blur' | 'unknown';
      chain: string;
      collectionSlug: string;
      contractAddress?: string;
    }
  | {
      type: 'asset';
      marketplace: 'opensea' | 'blur' | 'unknown';
      chain: string;
      contractAddress: string;
      tokenId: string;
      collectionSlug?: string;
    }
  | {
      type: 'contract';
      chain: string;
      contractAddress: string;
    }
  | {
      type: 'wallet';
      address: string;
    };

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  eth: 'ethereum',
  matic: 'polygon',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  base: 'base',
  optimism: 'optimism',
  avalanche: 'avalanche',
  solana: 'solana',
  sol: 'solana',
};

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function parseNftLink(input: string): ParsedLink | null {
  const trimmed = input.trim();

  // Try URL parsing
  try {
    const url = new URL(trimmed);
    return parseUrl(url);
  } catch {
    // Not a URL, try direct address patterns
  }

  // Contract address only
  if (ETH_ADDRESS_RE.test(trimmed)) {
    return { type: 'contract', chain: 'ethereum', contractAddress: trimmed.toLowerCase() };
  }

  // Contract:tokenId
  const contractTokenMatch = trimmed.match(/^(0x[0-9a-fA-F]{40})[:/](\d+)$/);
  if (contractTokenMatch) {
    return {
      type: 'asset',
      marketplace: 'unknown',
      chain: 'ethereum',
      contractAddress: contractTokenMatch[1].toLowerCase(),
      tokenId: contractTokenMatch[2],
    };
  }

  return null;
}

function parseUrl(url: URL): ParsedLink | null {
  const hostname = url.hostname.replace('www.', '');

  if (hostname === 'opensea.io') {
    return parseOpenSeaUrl(url);
  }

  if (hostname === 'blur.io') {
    return parseBlurUrl(url);
  }

  return null;
}

function parseOpenSeaUrl(url: URL): ParsedLink | null {
  const parts = url.pathname.split('/').filter(Boolean);

  // https://opensea.io/collection/azuki
  if (parts[0] === 'collection' && parts[1]) {
    return {
      type: 'collection',
      marketplace: 'opensea',
      chain: 'ethereum',
      // Strip trailing punctuation that often rides along when URLs are pasted
      collectionSlug: parts[1].replace(/[-_.\s]+$/, ''),
    };
  }

  // https://opensea.io/assets/ethereum/0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/1234
  if (parts[0] === 'assets' && parts.length >= 4) {
    const chainRaw = parts[1];
    const contractAddress = parts[2];
    const tokenId = parts[3];
    const chain = CHAIN_MAP[chainRaw.toLowerCase()] ?? chainRaw;

    if (ETH_ADDRESS_RE.test(contractAddress) && /^\d+$/.test(tokenId)) {
      return {
        type: 'asset',
        marketplace: 'opensea',
        chain,
        contractAddress: contractAddress.toLowerCase(),
        tokenId,
      };
    }
  }

  // https://opensea.io/assets/0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/1234 (legacy)
  if (parts[0] === 'assets' && parts.length === 3) {
    const contractAddress = parts[1];
    const tokenId = parts[2];
    if (ETH_ADDRESS_RE.test(contractAddress) && /^\d+$/.test(tokenId)) {
      return {
        type: 'asset',
        marketplace: 'opensea',
        chain: 'ethereum',
        contractAddress: contractAddress.toLowerCase(),
        tokenId,
      };
    }
  }

  return null;
}

function parseBlurUrl(url: URL): ParsedLink | null {
  const parts = url.pathname.split('/').filter(Boolean);

  // https://blur.io/collection/azuki
  if (parts[0] === 'collection' && parts[1]) {
    return {
      type: 'collection',
      marketplace: 'blur',
      chain: 'ethereum',
      collectionSlug: parts[1],
    };
  }

  // https://blur.io/asset/0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/1234
  if (parts[0] === 'asset' && parts.length >= 3) {
    const contractAddress = parts[1];
    const tokenId = parts[2];
    if (ETH_ADDRESS_RE.test(contractAddress) && /^\d+$/.test(tokenId)) {
      return {
        type: 'asset',
        marketplace: 'blur',
        chain: 'ethereum',
        contractAddress: contractAddress.toLowerCase(),
        tokenId,
      };
    }
  }

  return null;
}

export function isWalletAddress(input: string): boolean {
  const t = input.trim();
  return ETH_ADDRESS_RE.test(t) || SOLANA_ADDRESS_RE.test(t);
}
