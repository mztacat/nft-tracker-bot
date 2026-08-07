import { CollectionData, AssetData, ERC721OwnerData, ERC1155HoldersData, CollectionHoldersData } from '../providers/types.js';

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return 'N/A';
  return n.toFixed(decimals);
}

function fmtChange(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function escHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatCollectionSummary(data: CollectionData): string {
  const lines = [
    `<b>${escHtml(data.name)}</b>`,
    `Chain: ${data.chain}`,
    `Floor: <b>${fmt(data.floorPrice)} ETH</b>`,
    `24h Volume: ${fmt(data.volume24h)} ETH`,
    `24h Sales: ${data.sales24h ?? 'N/A'}`,
    `Floor Change (24h): ${fmtChange(data.floorChange24h)}`,
    `Volume Change (24h): ${fmtChange(data.volumeChange24h)}`,
    `Listings: ${data.listingsCount ?? 'N/A'}`,
    `Unique Holders: ${data.holdersCount ?? 'N/A'}`,
    `Total Supply: ${data.totalSupply ?? 'N/A'}`,
    `<i>Updated: ${data.updatedAt.toUTCString()}</i>`,
  ];
  return lines.join('\n');
}

export function formatAssetSummary(data: AssetData): string {
  const premiumDiscount = data.listingPrice != null && data.floorPrice != null && data.floorPrice > 0
    ? ((data.listingPrice - data.floorPrice) / data.floorPrice) * 100
    : null;

  const lines = [
    `<b>${escHtml(data.name ?? `#${data.tokenId}`)}</b>`,
    `Collection: ${escHtml(data.collectionName)}`,
    `Token ID: ${data.tokenId}`,
    `Chain: ${data.chain}`,
    `Standard: ${data.tokenStandard ?? 'N/A'}`,
    `Owner: <code>${shortAddr(data.ownerAddress ?? 'Unknown')}</code>`,
    `Status: ${data.isListed ? '🟢 Listed' : '⚫ Not listed'}`,
    data.listingPrice != null ? `Listing Price: <b>${fmt(data.listingPrice)} ETH</b>` : `Listing Price: N/A`,
    `Last Sale: ${fmt(data.lastSalePrice)} ETH`,
    `Collection Floor: ${fmt(data.floorPrice)} ETH`,
    premiumDiscount != null ? `vs Floor: ${fmtChange(premiumDiscount)}` : `vs Floor: N/A`,
    data.rarityRank != null ? `Rarity Rank: #${data.rarityRank}` : `Rarity Rank: N/A`,
    `<i>Updated: ${data.updatedAt.toUTCString()}</i>`,
  ];
  return lines.join('\n');
}

export function formatERC721Owner(data: ERC721OwnerData): string {
  const lines = [
    `<b>Current Owner</b>`,
    `Address: <code>${shortAddr(data.currentOwner)}</code>`,
    data.ownerSince ? `Owner Since: ${data.ownerSince.toDateString()}` : null,
    data.lastTransferTime ? `Last Transfer: ${data.lastTransferTime.toDateString()}` : null,
    data.previousOwner ? `Previous Owner: <code>${shortAddr(data.previousOwner)}</code>` : null,
    data.ownerNftCount != null ? `NFTs Held: ${data.ownerNftCount}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export function formatERC1155Holders(data: ERC1155HoldersData): string {
  const topHoldersText = data.topHolders
    .map((h, i) => `  ${i + 1}. <code>${shortAddr(h.address)}</code> — ${h.balance ?? '?'} (${h.percentage != null ? h.percentage.toFixed(2) + '%' : '?'})`)
    .join('\n');

  return [
    `<b>ERC-1155 Holders</b>`,
    `Total Supply: ${data.totalSupply}`,
    `Unique Holders: ${data.uniqueHolders}`,
    ``,
    `<b>Top Holders:</b>`,
    topHoldersText || '  N/A',
  ].join('\n');
}

export function formatCollectionHolders(data: CollectionHoldersData): string {
  const topHoldersText = data.topHolders
    .slice(0, 10)
    .map((h, i) => `  ${i + 1}. <code>${shortAddr(h.address)}</code> — ${h.balance ?? '?'} (${h.percentage != null ? h.percentage.toFixed(2) + '%' : '?'})`)
    .join('\n');

  return [
    `<b>Collection Holders</b>`,
    `Unique Holders: ${data.uniqueHolders}`,
    `Total Supply: ${data.totalSupply}`,
    data.top10Concentration != null ? `Top 10 Concentration: ${data.top10Concentration.toFixed(1)}%` : null,
    data.top50Concentration != null ? `Top 50 Concentration: ${data.top50Concentration.toFixed(1)}%` : null,
    data.holderChange24h != null ? `Holder Change (24h): ${data.holderChange24h > 0 ? '+' : ''}${data.holderChange24h}` : null,
    data.newHolders24h != null ? `New Holders (24h): ${data.newHolders24h}` : null,
    ``,
    `<b>Top 10 Holders:</b>`,
    topHoldersText || '  N/A',
  ].filter(Boolean).join('\n');
}

export function formatAlertFloorChange(collectionName: string, floor: number, prev: number, chain: string): string {
  const change = ((floor - prev) / prev) * 100;
  return [
    `📊 <b>Floor Change Alert</b>`,
    ``,
    `Collection: <b>${escHtml(collectionName)}</b>`,
    `Floor: <b>${fmt(floor)} ETH</b>`,
    `Previous: ${fmt(prev)} ETH`,
    `Change: <b>${fmtChange(change)}</b>`,
  ].join('\n');
}

export function formatAlertSale(collectionName: string, tokenId: string, price: number): string {
  return [
    `💰 <b>Sale Alert</b>`,
    ``,
    `Collection: <b>${escHtml(collectionName)}</b>`,
    `Token: #${tokenId}`,
    `Price: <b>${fmt(price)} ETH</b>`,
  ].join('\n');
}

export function formatDigest(collectionName: string, stats: {
  sales: number;
  volume: number;
  floor: number;
  floorChange: number | null;
  newListings: number;
  delistings: number;
  whaleBuys: number;
}): string {
  return [
    `📋 <b>${escHtml(collectionName)} Digest — Last Hour</b>`,
    ``,
    `Sales: ${stats.sales}`,
    `Volume: ${fmt(stats.volume)} ETH`,
    `Floor: ${fmt(stats.floor)} ETH`,
    stats.floorChange != null ? `Floor Change: ${fmtChange(stats.floorChange)}` : null,
    `New Listings: ${stats.newListings}`,
    `Delistings: ${stats.delistings}`,
    `Whale Buys: ${stats.whaleBuys}`,
  ].filter(Boolean).join('\n');
}

export function formatOwnerChangeAlert(collectionName: string, tokenId: string, newOwner: string, oldOwner?: string | null): string {
  return [
    `🔄 <b>Owner Change Alert</b>`,
    ``,
    `Collection: <b>${escHtml(collectionName)}</b>`,
    `Token: #${tokenId}`,
    oldOwner ? `From: <code>${shortAddr(oldOwner)}</code>` : null,
    `To: <code>${shortAddr(newOwner)}</code>`,
  ].filter(Boolean).join('\n');
}
