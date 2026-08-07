import { NftDataProvider } from './types.js';
import { MockProvider } from './mock.provider.js';
import { ReservoirProvider } from './reservoir.provider.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';

let _provider: NftDataProvider | null = null;

export function getProvider(): NftDataProvider {
  if (_provider) return _provider;

  const reservoir = new ReservoirProvider();
  if (reservoir.isAvailable()) {
    logger.info('Using Reservoir data provider');
    _provider = reservoir;
    return _provider;
  }

  logger.warn('No production NFT provider configured. Using mock provider.');
  _provider = new MockProvider();
  return _provider;
}

export * from './types.js';
