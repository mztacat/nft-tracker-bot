import { MockProvider } from '../services/providers/mock.provider.js';

describe('MockProvider', () => {
  const provider = new MockProvider();

  it('is always available', () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it('returns known collection data for azuki', async () => {
    const data = await provider.getCollectionData('azuki');
    expect(data).not.toBeNull();
    expect(data?.name).toBe('Azuki');
    expect(data?.floorPrice).toBeGreaterThan(0);
    expect(data?.chain).toBe('ethereum');
  });

  it('returns generic mock data for unknown collection', async () => {
    const data = await provider.getCollectionData('unknowncollection999');
    expect(data).not.toBeNull();
    expect(data?.floorPrice).toBeGreaterThanOrEqual(0);
  });

  it('returns asset data for known contract/token', async () => {
    const data = await provider.getAssetData(
      '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      '1234'
    );
    expect(data).not.toBeNull();
    expect(data?.tokenId).toBe('1234');
    expect(data?.tokenStandard).toBe('ERC-721');
  });

  it('returns generic asset data for unknown contract', async () => {
    const data = await provider.getAssetData('0x' + '1'.repeat(40), '9999');
    expect(data).not.toBeNull();
    expect(data?.tokenId).toBe('9999');
  });

  it('returns ERC-721 owner data', async () => {
    const data = await provider.getERC721Owner('0x' + '1'.repeat(40), '1');
    expect(data).not.toBeNull();
    expect(data?.currentOwner).toMatch(/^0x/);
    expect(typeof data?.ownerNftCount).toBe('number');
  });

  it('returns ERC-1155 holder data', async () => {
    const data = await provider.getERC1155Holders('0x' + '1'.repeat(40), '1');
    expect(data).not.toBeNull();
    expect(data?.uniqueHolders).toBeGreaterThan(0);
    expect(Array.isArray(data?.topHolders)).toBe(true);
  });

  it('returns collection holder data', async () => {
    const data = await provider.getCollectionHolders('0x' + '1'.repeat(40));
    expect(data).not.toBeNull();
    expect(data?.uniqueHolders).toBeGreaterThan(0);
    expect(data?.topHolders.length).toBeGreaterThan(0);
  });
});
