import { NftDataProvider } from './types.js';
import { MockProvider } from './mock.provider.js';
import { AlchemyProvider } from './alchemy.provider.js';
import { logger } from '../../logger.js';

let _provider: NftDataProvider | null = null;

export function getProvider(): NftDataProvider {
  if (_provider) return _provider;

  const alchemy = new AlchemyProvider();
  if (alchemy.isAvailable()) {
    logger.info('Using Alchemy data provider');
    _provider = alchemy;
    return _provider;
  }

  logger.warn('No production NFT provider configured. Using mock provider (demo data).');
  _provider = new MockProvider();
  return _provider;
}

export * from './types.js';
