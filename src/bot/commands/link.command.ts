import { Bot } from 'grammy';
import { parseNftLink } from '../../services/parser/link.parser.js';
import { getCollectionSummary } from '../../services/nft/collection.service.js';
import { getAssetSummary } from '../../services/nft/asset.service.js';
import { formatCollectionSummary, formatAssetSummary } from '../../services/formatter/index.js';
import { requireApproved } from '../middlewares/auth.middleware.js';

export function registerLinkCommand(bot: Bot): void {
  // /link command — prompt user to paste a link
  bot.command('link', requireApproved, async (ctx) => {
    await ctx.reply(
      '🔗 <b>Add NFT Link</b>\n\nPaste an OpenSea collection or asset link, a contract address, or a contract:tokenId pair.\n\nExamples:\n• <code>https://opensea.io/collection/azuki</code>\n• <code>https://opensea.io/assets/ethereum/0xbc4ca.../1234</code>\n• <code>0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d:1234</code>',
      { parse_mode: 'HTML' }
    );
  });

  // Handle any message that looks like an NFT link
  bot.on('message:text', requireApproved, async (ctx, next) => {
    const text = ctx.message.text.trim();

    // Skip if it starts with / (command)
    if (text.startsWith('/')) return next();

    const parsed = parseNftLink(text);
    if (!parsed) return next();

    const waitMsg = await ctx.reply('⏳ Fetching data...');

    try {
      if (parsed.type === 'collection') {
        const data = await getCollectionSummary(parsed.collectionSlug, parsed.chain);
        if (!data) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            '⚠️ Data unavailable right now. Please try again later.'
          );
          return;
        }

        const summary = formatCollectionSummary(data);
        await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, summary, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📌 Track Collection', callback_data: `track_collection:${parsed.collectionSlug}:${parsed.chain}` }],
              [{ text: '👥 View Holders', callback_data: `col_holders:${data.contractAddress}` }],
              [{ text: '🔔 Notifications', callback_data: `notif_menu_col:${parsed.collectionSlug}` }],
              [{ text: '❌ Cancel', callback_data: 'cancel' }],
            ],
          },
        });
      } else if (parsed.type === 'asset') {
        const data = await getAssetSummary(parsed.contractAddress, parsed.tokenId, parsed.chain);
        if (!data) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            '⚠️ Data unavailable right now. Please try again later.'
          );
          return;
        }

        const summary = formatAssetSummary(data);
        await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, summary, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📌 Track Asset', callback_data: `track_asset:${parsed.contractAddress}:${parsed.tokenId}` }],
              [{ text: '👤 View Owner', callback_data: `nft_owner:${parsed.contractAddress}:${parsed.tokenId}` }],
              [{ text: '🔔 Notifications', callback_data: `notif_menu_asset:${parsed.contractAddress}:${parsed.tokenId}` }],
              [{ text: '❌ Cancel', callback_data: 'cancel' }],
            ],
          },
        });
      } else if (parsed.type === 'contract') {
        await ctx.api.editMessageText(
          ctx.chat.id,
          waitMsg.message_id,
          `📄 <b>Contract Address</b>\n\n<code>${parsed.contractAddress}</code>\n\nWhat would you like to do?`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👥 View Collection Holders', callback_data: `col_holders:${parsed.contractAddress}` }],
                [{ text: '❌ Cancel', callback_data: 'cancel' }],
              ],
            },
          }
        );
      }
    } catch (err) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        '⚠️ An error occurred while fetching data. Please try again later.'
      ).catch(() => {});
    }
  });
}
