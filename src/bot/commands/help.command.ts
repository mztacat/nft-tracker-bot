import { Bot } from 'grammy';

const HELP_TEXT = `
<b>NFT Tracker Bot — Commands</b>

<b>General</b>
/start — Start the bot
/help — Show this help
/menu — Open main menu
/request — Request access

<b>Tracking</b>
/link — Add an NFT or collection link
/tracking — View your tracked items
/holders — View holder/owner info
/notifications — Manage notification settings

<b>Admin</b>
/access — Admin access panel
/requests — Pending access requests
/approve &lt;user_id&gt; — Approve a user
/deny &lt;user_id&gt; — Deny a user
/broadcast — Broadcast a message to all approved users

<b>Tips</b>
• Paste any OpenSea link directly in chat to get collection or asset info.
• Use inline buttons to track, configure alerts, and manage items.
`.trim();

export function registerHelpCommand(bot: Bot): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
  });
}
