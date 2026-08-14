import { Bot } from 'grammy';
import { prisma } from '../../db/client.js';
import { config } from '../../config/index.js';
import { replyAutoDelete } from '../../utils/auto-delete.js';

const HELP_TEXT = `
<b>NFT Lookinto — Commands</b>
<i>Floors · Whales · Wallets · Snipes</i>

<b>General</b>
/start — Register and get started
/menu — Open the main menu
/help — Show this help
/request — Request access

<b>Collections</b>
/link — Paste any OpenSea link to look up &amp; track
/tracking — Everything you're tracking + untrack buttons
/holders — Holder leaderboard for any tracked collection
/notifications — Toggle each alert type on/off per collection

<b>Wallets</b>
/trackwallet <code>0x… [label]</code> — Follow a wallet's buys, mints &amp; sells
/wallets — List tracked wallets + untrack buttons
/portfolio <code>0x…</code> — Holdings, floors &amp; estimated total value
/history <code>&lt;wallet&gt; &lt;collection&gt;</code> — Full buy/sell log with prices paid
/pnl <code>&lt;wallet&gt; &lt;collection&gt;</code> — Realized + unrealized P&amp;L with FIFO cost basis

<b>Alpha Tools</b>
/traitalert <code>&lt;collection&gt; Trait=Value</code> — Alert when that tier hits market (💎 snipe-flagged)
/traitalert <code>&lt;collection&gt; off</code> — Turn off trait alerts
/trackdeployer <code>&lt;contract or OpenSea URL&gt;</code> — Alert when the team deploys a new contract or token
/setthreshold <code>&lt;collection&gt; &lt;pct&gt;</code> — Min % floor move to alert (default 5%)
/setthreshold <code>&lt;collection&gt; whale &lt;ETH&gt;</code> — Min ETH spend to trigger whale alert (default 5)
/setthreshold <code>&lt;collection&gt;</code> — View current thresholds
/snooze <code>&lt;collection&gt; 1h|6h|1d|off</code> — Silence alerts temporarily (or tap 🔕 on any alert)

<b>Alerts you can get</b>
📉 Floor moves · 🐋 Whale buys &amp; sweeps · 🚪 Holder exits
🏷 Trait listings · 💎 Below-floor snipes · 👛 Wallet activity · 🚀 New deployments

<b>Tips</b>
• Paste any OpenSea URL in chat — no command needed, bot looks it up instantly.
• All commands accept full OpenSea URLs wherever they ask for a collection.
• In groups, command responses auto-delete after 2 min to keep chat clean.
• Prices shown as <b>ETH [$USD]</b> using live ETH price.
`.trim();

const ADMIN_TEXT = `

<b>Admin</b>
/access — Access control panel
/requests — Pending access requests
/approve <code>&lt;user_id&gt;</code> — Approve a user
/deny <code>&lt;user_id&gt;</code> — Deny a user
/approvegroup <code>&lt;chat_id&gt;</code> — Approve a group chat
/broadcast — Send message to all approved users`;

export function registerHelpCommand(bot: Bot): void {
  bot.command('help', async (ctx) => {
    const from = ctx.from!;
    let isAdmin = String(from.id) === config.OWNER_ID;
    if (!isAdmin) {
      const user = await prisma.user.findUnique({ where: { telegramId: String(from.id) } });
      isAdmin = user?.isAdmin ?? false;
    }
    await replyAutoDelete(ctx, isAdmin ? HELP_TEXT + ADMIN_TEXT : HELP_TEXT, { parse_mode: 'HTML' });
  });
}
