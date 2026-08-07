import {
  formatCollectionSummary,
  formatAssetSummary,
  formatERC721Owner,
  formatCollectionHolders,
  formatAlertFloorChange,
  formatDigest,
} from '../services/formatter/index.js';

const mockCollection = {
  name: 'Azuki',
  slug: 'azuki',
  chain: 'ethereum',
  contractAddress: '0xed5af388653567af2f388e6224dc7c4b3241c544',
  floorPrice: 6.48,
  volume24h: 51.4,
  sales24h: 8,
  floorChange24h: 6.2,
  volumeChange24h: 12.5,
  listingsCount: 420,
  holdersCount: 5241,
  totalSupply: 10000,
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

const mockAsset = {
  tokenId: '1234',
  contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
  chain: 'ethereum',
  collectionName: 'Bored Ape Yacht Club',
  collectionSlug: 'boredapeyachtclub',
  ownerAddress: '0xabc123def456abc123def456abc123def456abc1',
  isListed: true,
  listingPrice: 12.5,
  lastSalePrice: 10.8,
  floorPrice: 11.5,
  rarityRank: 342,
  tokenStandard: 'ERC-721',
  name: 'Bored Ape #1234',
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

describe('Formatter', () => {
  describe('formatCollectionSummary', () => {
    it('includes collection name', () => {
      const result = formatCollectionSummary(mockCollection);
      expect(result).toContain('Azuki');
    });

    it('includes floor price', () => {
      const result = formatCollectionSummary(mockCollection);
      expect(result).toContain('6.48');
    });

    it('includes floor change with sign', () => {
      const result = formatCollectionSummary(mockCollection);
      expect(result).toContain('+6.20%');
    });

    it('handles null values gracefully', () => {
      const result = formatCollectionSummary({ ...mockCollection, floorPrice: null, volume24h: null });
      expect(result).toContain('N/A');
    });
  });

  describe('formatAssetSummary', () => {
    it('includes token ID', () => {
      const result = formatAssetSummary(mockAsset);
      expect(result).toContain('1234');
    });

    it('shows listed status', () => {
      const result = formatAssetSummary(mockAsset);
      expect(result).toContain('Listed');
    });

    it('shows rarity rank', () => {
      const result = formatAssetSummary(mockAsset);
      expect(result).toContain('342');
    });

    it('shortens owner address', () => {
      const result = formatAssetSummary(mockAsset);
      expect(result).toContain('0xabc1');
      expect(result).not.toContain('0xabc123def456abc123def456abc123def456abc1');
    });
  });

  describe('formatERC721Owner', () => {
    it('shows current owner', () => {
      const result = formatERC721Owner({
        currentOwner: '0x' + 'b'.repeat(40),
        ownerSince: new Date('2023-06-01'),
        lastTransferTime: new Date('2023-06-01'),
        previousOwner: '0x' + 'c'.repeat(40),
        ownerNftCount: 12,
      });
      expect(result).toContain('Current Owner');
      expect(result).toContain('12');
    });
  });

  describe('formatCollectionHolders', () => {
    it('shows holder count and top holders', () => {
      const result = formatCollectionHolders({
        uniqueHolders: 5241,
        totalSupply: 10000,
        topHolders: [{ address: '0x' + 'a'.repeat(40), balance: 200, percentage: 2.0 }],
        top10Concentration: 12.5,
        top50Concentration: 38.2,
        holderChange24h: 15,
        newHolders24h: 23,
      });
      expect(result).toContain('5241');
      expect(result).toContain('12.5%');
    });
  });

  describe('formatAlertFloorChange', () => {
    it('shows floor change alert', () => {
      const result = formatAlertFloorChange('Azuki', 6.48, 6.10, 'ethereum');
      expect(result).toContain('Floor Change Alert');
      expect(result).toContain('6.48');
      expect(result).toContain('+');
    });
  });

  describe('formatDigest', () => {
    it('shows digest summary', () => {
      const result = formatDigest('Azuki', {
        sales: 8,
        volume: 51.4,
        floor: 6.42,
        floorChange: 4.1,
        newListings: 12,
        delistings: 4,
        whaleBuys: 1,
      });
      expect(result).toContain('Digest');
      expect(result).toContain('Azuki');
      expect(result).toContain('51.40');
    });
  });
});
