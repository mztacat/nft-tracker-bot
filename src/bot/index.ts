import { Bot } from 'grammy';
import { config } from '../config/index.js';
import { upsertUser } from './middlewares/auth.middleware.js';
import { rateLimitMiddleware } from './middlewares/rate-limit.middleware.js';
import {
  registerStartCommand,
  registerHelpCommand,
  registerMenuCommand,
  registerRequestCommand,
  registerLinkCommand,
  registerTrackingCommand,
  registerHoldersCommand,
  registerNotificationsCommand,
  registerAccessCommands,
} from './commands/index.js';
import { registerWalletCommand } from './commands/wallet.command.js';
import { registerTraitsCommand } from './commands/traits.command.js';
import { registerDeployerCommand } from './commands/deployer.command.js';
import { registerHistoryCommand } from './commands/history.command.js';
import { registerThresholdCommand } from './commands/threshold.command.js';
import { registerCallbackHandlers } from './handlers/callback.handler.js';
import { logger } from '../logger.js';

export function createBot(): Bot {
  const bot = new Bot(config.BOT_TOKEN);

  // Global middleware
  bot.use(async (ctx, next) => {
    try {
      await upsertUser(ctx);
    } catch (err) {
      logger.error({ err }, 'upsertUser failed in global middleware');
    }
    return next();
  });

  bot.use(rateLimitMiddleware);

  // Register all commands
  registerStartCommand(bot);
  registerHelpCommand(bot);
  registerMenuCommand(bot);
  registerRequestCommand(bot);
  registerLinkCommand(bot);
  registerTrackingCommand(bot);
  registerHoldersCommand(bot);
  registerNotificationsCommand(bot);
  registerWalletCommand(bot);
  registerTraitsCommand(bot);
  registerDeployerCommand(bot);
  registerHistoryCommand(bot);
  registerThresholdCommand(bot);
  registerAccessCommands(bot);
  registerCallbackHandlers(bot);

  // /status command
  bot.command('status', async (ctx) => {
    const from = ctx.from!;
    const isOwner = String(from.id) === config.OWNER_ID;
    if (!isOwner) { await ctx.reply('⛔ Owner only.'); return; }
    await ctx.reply(`🤖 Bot is running.\nNode: ${process.version}\nEnv: ${config.NODE_ENV}`);
  });

  // Error handler
  bot.catch((err) => {
    logger.error({ err: err.error, ctx: err.ctx?.update?.update_id }, 'Bot error');
  });

  return bot;
}

export async function registerBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'help', description: 'Show help' },
    { command: 'menu', description: 'Open main menu' },
    { command: 'request', description: 'Request access' },
    { command: 'link', description: 'Add NFT or collection link' },
    { command: 'tracking', description: 'View tracked items' },
    { command: 'holders', description: 'View holder info' },
    { command: 'trackwallet', description: 'Track a wallet\'s NFT activity' },
    { command: 'wallets', description: 'Manage tracked wallets' },
    { command: 'portfolio', description: 'Wallet holdings & estimated value' },
    { command: 'history', description: 'Wallet buy/sell history in a collection' },
    { command: 'setthreshold', description: 'Set min % for floor alerts / min ETH for whale alerts' },
    { command: 'trackdeployer', description: 'Alert when a team deploys a new contract' },
    { command: 'traitalert', description: 'Alert when a trait (e.g. tier) is listed' },
    { command: 'notifications', description: 'Manage notifications' },
    { command: 'access', description: 'Admin access panel' },
    { command: 'requests', description: 'Pending requests' },
    { command: 'broadcast', description: 'Broadcast message (admin)' },
    { command: 'status', description: 'Bot status (owner)' },
  ]);
  logger.info('Bot commands registered');
}
