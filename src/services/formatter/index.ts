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
  const time = data.updatedAt.toUTCString().replace(/:\d{2} GMT$/, ' UTC');
  const lines: (string | null)[] = [
    `<b>${escHtml(data.name)}</b>`,
    `<code>${shortAddr(data.contractAddress ?? '')}</code> · ${data.chain}`,
    ``,
    data.floorPrice != null ? `Floor  <b>${fmt(data.floorPrice, 4)} ETH</b>` : null,
    data.floorChange24h != null ? `24h  ${fmtChange(data.floorChange24h)}` : null,
    data.volume24h != null ? `Volume 24h  ${fmt(data.volume24h)} ETH` : null,
    data.sales24h != null ? `Sales 24h  ${data.sales24h}` : null,
    data.listingsCount != null ? `Listed  ${data.listingsCount}` : null,
    data.holdersCount != null ? `Holders  ${data.holdersCount}` : null,
    data.totalSupply != null ? `Supply  ${data.totalSupply}` : null,
    ``,
    `<i>${time}</i>`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export function formatAssetSummary(data: AssetData): string {
  const premiumDiscount = data.listingPrice != null && data.floorPrice != null && data.floorPrice > 0
    ? ((data.listingPrice - data.floorPrice) / data.floorPrice) * 100
    : null;

  const time = data.updatedAt.toUTCString().replace(/:\d{2} GMT$/, ' UTC');
  const lines: (string | null)[] = [
    `<b>${escHtml(data.name ?? `#${data.tokenId}`)}</b>`,
    `${escHtml(data.collectionName)} · ${data.chain}${data.tokenStandard ? ` · ${data.tokenStandard}` : ''}`,
    ``,
    data.ownerAddress ? `Owner  <code>${shortAddr(data.ownerAddress)}</code>` : null,
    `Status  ${data.isListed ? 'Listed' : 'Not listed'}`,
    data.listingPrice != null ? `Price  <b>${fmt(data.listingPrice, 4)} ETH</b>` : null,
    data.lastSalePrice != null ? `Last Sale  ${fmt(data.lastSalePrice, 4)} ETH` : null,
    data.floorPrice != null ? `Floor  ${fmt(data.floorPrice, 4)} ETH` : null,
    premiumDiscount != null ? `vs Floor  ${fmtChange(premiumDiscount)}` : null,
    data.rarityRank != null ? `Rarity  #${data.rarityRank}` : null,
    ``,
    `<i>${time}</i>`,
  ];
  return lines.filter((l) => l !== null).join('\n');
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

export function formatWhaleAlert(params: {
  collectionName: string;
  buyer: string;
  count: number;
  tokenIds: string[];
  windowMinutes: number;
  isMint: boolean;
}): string {
  const { collectionName, buyer, count, tokenIds, windowMinutes, isMint } = params;
  const sample = tokenIds.slice(0, 5).map((t) => `#${t}`).join(', ');
  return [
    `🐋 <b>${isMint ? 'Whale Mint' : 'Sweep Detected'}</b>`,
    ``,
    `<b>${escHtml(collectionName)}</b>`,
    `Wallet  <code>${shortAddr(buyer)}</code>`,
    `${isMint ? 'Minted' : 'Acquired'}  <b>${count} items</b> in ${windowMinutes} min`,
    tokenIds.length ? `Tokens  ${sample}${tokenIds.length > 5 ? '…' : ''}` : null,
    ``,
    `<a href="https://etherscan.io/address/${buyer}">Etherscan</a> · <a href="https://opensea.io/${buyer}">OpenSea</a>`,
  ].filter(Boolean).join('\n');
}

function normalizeTokenId(tokenId: string): string {
  if (/^0x[0-9a-fA-F]+$/.test(tokenId)) {
    try {
      return BigInt(tokenId).toString(10);
    } catch {
      return tokenId;
    }
  }
  return tokenId;
}

export function formatWalletActivityAlert(params: {
  wallet: string;
  label?: string | null;
  direction: 'in' | 'out';
  collectionName: string;
  contractAddress?: string | null;
  tokenIds: string[];
  txHash: string;
}): string {
  const { wallet, label, direction, collectionName, contractAddress, tokenIds, txHash } = params;
  const ids = tokenIds.map(normalizeTokenId);
  const sample = ids
    .slice(0, 5)
    .map((id) =>
      contractAddress
        ? `<a href="https://opensea.io/assets/ethereum/${contractAddress}/${id}">#${id}</a>`
        : `#${id}`
    )
    .join(', ');
  return [
    `${direction === 'in' ? '🟢' : '🔴'} <b>Wallet ${direction === 'in' ? 'Acquired' : 'Sent'} NFTs</b>`,
    ``,
    `Wallet  <code>${shortAddr(wallet)}</code>${label ? ` (${escHtml(label)})` : ''}`,
    `Collection  <b>${escHtml(collectionName)}</b>`,
    `Tokens  ${sample}${ids.length > 5 ? ` +${ids.length - 5} more` : ''}`,
    ``,
    `<a href="https://etherscan.io/tx/${txHash}">Transaction</a>${
      contractAddress ? `  ·  <a href="https://opensea.io/assets/ethereum/${contractAddress}/${ids[0]}">View on OpenSea</a>` : ''
    }`,
  ].join('\n');
}

export function formatPortfolio(params: {
  wallet: string;
  label?: string | null;
  totalNfts: number;
  totalCollections: number;
  totalEstValueEth: number;
  pricedCollections: number;
  holdings: { name: string; count: number; floorEth: number | null; estValueEth: number | null }[];
}): string {
  const { wallet, label, totalNfts, totalCollections, totalEstValueEth, pricedCollections, holdings } = params;
  const top = holdings.slice(0, 10);
  const rows = top.map((h) => {
    const value =
      h.estValueEth != null ? `${h.estValueEth.toFixed(2)} ETH` : '—';
    const floor = h.floorEth != null ? ` @ ${h.floorEth.toFixed(3)}` : '';
    return `• <b>${escHtml(h.name)}</b>  ×${h.count}${floor}  →  ${value}`;
  });
  return [
    `💼 <b>Wallet Portfolio</b>`,
    ``,
    `Wallet  <code>${shortAddr(wallet)}</code>${label ? ` (${escHtml(label)})` : ''}`,
    `NFTs  <b>${totalNfts}</b> across <b>${totalCollections}</b> collections`,
    `Est. value  <b>${totalEstValueEth.toFixed(2)} ETH</b> <i>(floor × count, ${pricedCollections} priced collections)</i>`,
    ``,
    `<b>Top holdings</b>`,
    ...rows,
    ...(holdings.length > 10 ? [`…and ${holdings.length - 10} more collections`] : []),
  ].join('\n');
}

export function formatTraitListingAlert(params: {
  collectionName: string;
  traitType: string;
  traitValue: string;
  tokenId: string;
  tokenName?: string | null;
  price: number | null;
  floor?: number | null;
  medianPrice?: number | null;
  isSnipe?: boolean;
  url: string;
}): string {
  const { collectionName, traitType, traitValue, tokenId, tokenName, price, floor, medianPrice, isSnipe, url } = params;
  const lines = [
    isSnipe
      ? `💎 <b>${escHtml(traitValue)} SNIPE — priced below usual!</b>`
      : `🏷 <b>${escHtml(traitValue)} Listed!</b>`,
    ``,
    `Collection  <b>${escHtml(collectionName)}</b>`,
    `Item  ${tokenName ? escHtml(tokenName) : `#${tokenId}`}`,
    `Trait  ${escHtml(traitType)} = <b>${escHtml(traitValue)}</b>`,
  ];
  if (price != null) {
    lines.push(`Price  <b>${price.toFixed(4)} ETH</b>`);
    if (floor != null && floor > 0) {
      lines.push(`vs Floor  ${(price / floor).toFixed(2)}x (floor ${floor.toFixed(4)} ETH)`);
    }
    if (medianPrice != null) {
      const diffPct = ((price - medianPrice) / medianPrice) * 100;
      lines.push(
        `vs Usual ${escHtml(traitValue)}  ${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(0)}% (median ${medianPrice.toFixed(4)} ETH)`
      );
    }
  }
  lines.push(``, `<a href="${url}">View on OpenSea</a>`);
  return lines.join('\n');
}

export function formatSnipeAlert(params: {
  collectionName: string;
  tokenId: string | null;
  price: number;
  floor: number;
  url?: string | null;
}): string {
  const { collectionName, tokenId, price, floor, url } = params;
  const belowPct = ((floor - price) / floor) * 100;
  return [
    `🎯 <b>Listed Below Floor</b>`,
    ``,
    `<b>${escHtml(collectionName)}</b>${tokenId ? ` #${tokenId}` : ''}`,
    `Price  <b>${fmt(price, 4)} ETH</b>`,
    `Floor  ${fmt(floor, 4)} ETH  (−${belowPct.toFixed(1)}%)`,
    url ? `\n<a href="${url}">View listing</a>` : null,
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

export function formatWhaleBuyAlert(params: {
  collectionName: string;
  buyer: string;
  itemCount: number;
  ethSpent: number | null;
  txCount: number;
  windowMinutes: number;
  isSweep: boolean;
}): string {
  const { collectionName, buyer, itemCount, ethSpent, txCount, windowMinutes, isSweep } = params;
  return [
    isSweep ? `🧹 <b>Sweep Alert</b>` : `🐋 <b>Whale Buy Alert</b>`,
    ``,
    `Collection: <b>${escHtml(collectionName)}</b>`,
    `Buyer: <code>${shortAddr(buyer)}</code>`,
    `Items: <b>${itemCount}</b> in ${txCount} tx${txCount === 1 ? '' : 's'}`,
    ethSpent != null && ethSpent > 0 ? `Spent: <b>${fmt(ethSpent)} ETH</b>` : null,
    `Window: last ${windowMinutes} min`,
  ].filter(Boolean).join('\n');
}
