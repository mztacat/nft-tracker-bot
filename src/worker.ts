import 'dotenv/config';
import cron from 'node-cron';
import { connectDb, disconnectDb } from './db/client.js';
import { runMarketWorker, runAssetWorker } from './workers/marketWorker.js';
import { runHolderWorker } from './workers/holderWorker.js';
import { runAlertWorker } from './workers/alertWorker.js';
import { runWhaleWorker } from './workers/whaleWorker.js';
import { runWalletWorker } from './workers/walletWorker.js';
import { runSnipeWorker } from './workers/snipeWorker.js';
import { logger } from './logger.js';
import { config } from './config/index.js';
import { createBot } from './bot/index.js';
import { initAlertEngine } from './services/alerts/alert.engine.js';

async function main() {
  logger.info('Starting NFT Tracker Worker');

  await connectDb();

  // The worker needs a bot instance for sending alerts
  const bot = createBot();
  initAlertEngine(bot);

  // Start bot in background (no long polling – worker only needs API access)
  // We initialise without calling bot.start() to avoid duplicate polling

  logger.info('Scheduling workers...');

  // Market data: every 60 seconds for active items
  cron.schedule('*/1 * * * *', async () => {
    try {
      await runMarketWorker();
    } catch (err) {
      logger.error({ err }, 'Market worker cron error');
    }
  });

  // Asset data: every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await runAssetWorker();
    } catch (err) {
      logger.error({ err }, 'Asset worker cron error');
    }
  });

  // Whale-buy & sweep detection: every 1 minute for instant alerts
  cron.schedule('*/1 * * * *', async () => {
    try {
      await runWhaleWorker();
    } catch (err) {
      logger.error({ err }, 'Whale worker cron error');
    }
  });

  // Wallet activity: every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await runWalletWorker();
    } catch (err) {
      logger.error({ err }, 'Wallet worker cron error');
    }
  });

  // Below-floor snipe scan: every 3 minutes
  cron.schedule('*/3 * * * *', async () => {
    try {
      await runSnipeWorker();
    } catch (err) {
      logger.error({ err }, 'Snipe worker cron error');
    }
  });

  // Holder data: every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      await runHolderWorker();
    } catch (err) {
      logger.error({ err }, 'Holder worker cron error');
    }
  });

  // Alert/digest processing: every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await runAlertWorker();
    } catch (err) {
      logger.error({ err }, 'Alert worker cron error');
    }
  });

  logger.info('Worker scheduled. Running initial tick...');

  // Run initial ticks
  await runMarketWorker().catch((err) => logger.error({ err }, 'Initial market tick failed'));
  await runAssetWorker().catch((err) => logger.error({ err }, 'Initial asset tick failed'));
  await runWhaleWorker().catch((err) => logger.error({ err }, 'Initial whale tick failed'));

  logger.info('Worker running. Waiting for scheduled jobs...');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutting down...');
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal worker error');
  process.exit(1);
});
