import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

/**
 * Optional OpenSea API v2 enhancer.
 * When OPENSEA_API_KEY is set, this resolves collection slugs authoritatively
 * and supplies market stats (volume, sales, floor, owners) that Alchemy's
 * free NFT API does not provide.
 * Free API key: https://docs.opensea.io/reference/api-keys
 */

const OS_BASE = 'https://api.opensea.io/api/v2';

export interface OpenSeaCollectionInfo {
  name: string;
  contractAddress: string | null;
  chain: string;
  imageUrl?: string;
  description?: string;
  totalSupply: number | null;
}

export interface OpenSeaStats {
  floorPrice: number | null;
  volume24h: number | null;
  sales24h: number | null;
  volumeChange24h: number | null;
  numOwners: number | null;
}

export function openSeaAvailable(): boolean {
  return Boolean(config.OPENSEA_API_KEY);
}

async function osFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${OS_BASE}${path}`, {
      headers: {
        accept: 'application/json',
        'x-api-key': config.OPENSEA_API_KEY!,
      },
    });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, 'OpenSea API non-OK response');
      return null;
    }
    return res.json() as Promise<T>;
  } catch (err) {
    logger.error({ err, path }, 'OpenSea fetch error');
    return null;
  }
}

export async function getOpenSeaCollection(slug: string): Promise<OpenSeaCollectionInfo | null> {
  const data = await osFetch<any>(`/collections/${encodeURIComponent(slug)}`);
  if (!data) return null;

  const contract = (data.contracts ?? [])[0];
  return {
    name: data.name ?? slug,
    contractAddress: contract?.address ?? null,
    chain: contract?.chain ?? 'ethereum',
    imageUrl: data.image_url ?? undefined,
    description: data.description ?? undefined,
    totalSupply: data.total_supply != null ? Number(data.total_supply) : null,
  };
}

export async function getOpenSeaStats(slug: string): Promise<OpenSeaStats | null> {
  const data = await osFetch<any>(`/collections/${encodeURIComponent(slug)}/stats`);
  if (!data) return null;

  const oneDay = (data.intervals ?? []).find((i: any) => i.interval === 'one_day');
  return {
    floorPrice: data.total?.floor_price ?? null,
    volume24h: oneDay?.volume ?? null,
    sales24h: oneDay?.sales ?? null,
    volumeChange24h: oneDay?.volume_change != null ? oneDay.volume_change * 100 : null,
    numOwners: data.total?.num_owners ?? null,
  };
}
