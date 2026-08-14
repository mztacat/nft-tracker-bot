import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';

const HELP_TEXT = `
<b>NFT Lookinto — Commands</b>
<i>Floors · Whales · Wallets · Snipes</i>

<b>General</b>
/start — Start the bot
/menu — Open the main menu
/help — Show this help
/request — Request access

<b>Collections</b>
/link — Add an NFT or collection link
/tracking — View your tracked items
/holders — Holder &amp; whale breakdown
/notifications — Toggle alerts per item

<b>Wallets</b>
/trackwallet <code>0x… [label]</code> — Follow a wallet's buys, mints &amp; sells
/wallets — List &amp; untrack wallets
/portfolio <code>0x…</code> — Holdings, floors &amp; estimated value

<b>Alpha Tools</b>
/traitalert <code>&lt;collection&gt; Trait=Value</code> — Tier listings, 💎 snipe-flagged
/trackdeployer <code>&lt;contract or slug&gt;</code> — Alert when the team deploys something new

<b>Alerts you can get</b>
📉 Floor moves · 🐋 Whale buys &amp; sweeps · 🚪 Holder exits
🏷 Trait listings · 💎 Below-floor snipes · 👛 Wallet activity · 🚀 New deployments

<b>Tips</b>
• Paste any OpenSea link in chat for an instant lookup.
• Every card has inline buttons — track, configure, done.
`.trim();

const ADMIN_TEXT = `

<b>Admin</b>
/access — Admin access panel
/requests — Pending access requests
/approve <code>&lt;user_id&gt;</code> — Approve a user
/deny <code>&lt;user_id&gt;</code> — Deny a user
/approvegroup <code>&lt;chat_id&gt;</code> — Approve a group
/broadcast — Message all approved users`;

export function registerHelpCommand(bot: Bot): void {
  bot.command('help', async (ctx) => {
    const from = ctx.from!;
    let isAdmin = String(from.id) === config.OWNER_ID;
    if (!isAdmin) {
      const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
      isAdmin = user?.isAdmin ?? false;
    }
    await ctx.reply(isAdmin ? HELP_TEXT + ADMIN_TEXT : HELP_TEXT, { parse_mode: 'HTML' });
  });
}
