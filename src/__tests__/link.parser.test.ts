import { parseNftLink } from '../services/parser/link.parser.js';

describe('parseNftLink', () => {
  describe('OpenSea collection links', () => {
    it('parses standard collection link', () => {
      const result = parseNftLink('https://opensea.io/collection/azuki');
      expect(result).toMatchObject({
        type: 'collection',
        marketplace: 'opensea',
        collectionSlug: 'azuki',
        chain: 'ethereum',
      });
    });

    it('parses collection link with www', () => {
      const result = parseNftLink('https://www.opensea.io/collection/boredapeyachtclub');
      expect(result).toMatchObject({
        type: 'collection',
        marketplace: 'opensea',
        collectionSlug: 'boredapeyachtclub',
      });
    });
  });

  describe('OpenSea asset links', () => {
    it('parses asset link with chain', () => {
      const result = parseNftLink(
        'https://opensea.io/assets/ethereum/0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/1234'
      );
      expect(result).toMatchObject({
        type: 'asset',
        marketplace: 'opensea',
        chain: 'ethereum',
        contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
        tokenId: '1234',
      });
    });

    it('parses legacy asset link', () => {
      const result = parseNftLink(
        'https://opensea.io/assets/0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/1234'
      );
      expect(result).toMatchObject({
        type: 'asset',
        marketplace: 'opensea',
        contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
        tokenId: '1234',
      });
    });
  });

  describe('Contract address', () => {
    it('parses plain contract address', () => {
      const result = parseNftLink('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d');
      expect(result).toMatchObject({
        type: 'contract',
        chain: 'ethereum',
        contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      });
    });

    it('parses contract:tokenId format', () => {
      const result = parseNftLink('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d:1234');
      expect(result).toMatchObject({
        type: 'asset',
        contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
        tokenId: '1234',
      });
    });
  });

  describe('Blur links', () => {
    it('parses blur collection link', () => {
      const result = parseNftLink('https://blur.io/collection/azuki');
      expect(result).toMatchObject({
        type: 'collection',
        marketplace: 'blur',
        collectionSlug: 'azuki',
      });
    });
  });

  describe('Invalid inputs', () => {
    it('returns null for plain text', () => {
      expect(parseNftLink('hello world')).toBeNull();
    });

    it('returns null for unknown URL', () => {
      expect(parseNftLink('https://example.com/something')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseNftLink('')).toBeNull();
    });
  });
});
