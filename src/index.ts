import 'dotenv/config';
import { createBot, registerBotCommands } from './bot/index.js';
import { connectDb, disconnectDb } from './db/client.js';
import { initAlertEngine } from './services/alerts/alert.engine.js';
import { logger } from './logger.js';
import { config } from './config/index.js';

async function main() {
  logger.info({ env: config.NODE_ENV }, 'Starting NFT Tracker Bot');

  await connectDb();

  const bot = createBot();

  initAlertEngine(bot);

  await registerBotCommands(bot);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    await bot.stop();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('Starting bot with long polling...');
  bot.start({
    onStart: (info) => {
      logger.info({ username: info.username }, 'Bot started successfully');
    },
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error starting bot');
  process.exit(1);
});
