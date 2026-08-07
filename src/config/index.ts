import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  OWNER_ID: z.string().min(1, 'OWNER_ID is required'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  ALCHEMY_API_KEY: z.string().optional(),
  OPENSEA_API_KEY: z.string().optional(),

  MAX_TRACKED_COLLECTIONS: z.coerce.number().default(10),
  MAX_TRACKED_ASSETS: z.coerce.number().default(20),
  MAX_TRACKED_WALLETS: z.coerce.number().default(5),

  ALERT_COOLDOWN_MINUTES: z.coerce.number().default(30),
  DEFAULT_DIGEST_MODE: z.enum(['instant', 'digest', 'muted']).default('instant'),

  MARKET_POLL_INTERVAL_ACTIVE: z.coerce.number().default(60_000),
  MARKET_POLL_INTERVAL_NORMAL: z.coerce.number().default(300_000),
  ASSET_POLL_INTERVAL: z.coerce.number().default(120_000),
  HOLDER_POLL_INTERVAL: z.coerce.number().default(1_800_000),
});

function loadConfig() {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid configuration:');
    result.error.errors.forEach((e) => {
      console.error(`  ${e.path.join('.')}: ${e.message}`);
    });
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
