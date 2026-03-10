// src/features/choco/index.js
const { Events, AttachmentBuilder, MessageFlags } = require('discord.js');
const { logger } = require('../../services/logger');
const { checkRequest } = require('../../services/contentFilter');
const { pickChocoImage, hasChocoKeyword } = require('./imageService');

// 環境変数
const CHOCO_DIR = process.env.CHOCO_DIR || './images';
const CHOCO_REPLY_EPHEMERAL = 
  String(process.env.CHOCO_REPLY_EPHEMERAL || 'false').toLowerCase() === 'true';

function mb(bytes) {
  return bytes / 1024 / 1024;
}

/**
 * Typing表示（エラーを無視）
 */
async function sendTypingSafe(channel, meta = {}) {
  try {
    await channel.sendTyping();
    logger.debug('choco.typing.sent', meta);
  } catch (e) {
    logger.warn('choco.typing.fail', { 
      ...meta, 
      err: e?.message 
    });
  }
}

module.exports = {
  name: 'choco',
  description: 'Random image sharing feature',

  enabled: () => {
    // 環境変数チェック
    if (!process.env.CHOCO_DIR) {
      return false;
    }

    // features.conf チェック
    const { isFeatureEnabled } = require('../../utils/featureConfig');
    return isFeatureEnabled('choco');
  },

  async setup(client) {
    // スラッシュコマンド: /choco
    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'choco') return;

        if (interaction.deferred || interaction.replied) return;

        const userId = interaction.user?.id;
        if (!userId) return;

        // スパムチェック
        const filterResult = checkRequest(userId, '');
        if (!filterResult.allowed) {
          logger.warn('choco.slash.filtered', { 
            userId, 
            reason: filterResult.reason 
          });

          let replyMsg = '🍫 ちょっとだけ待ってね';
          if (filterResult.reason === 'banned') {
            replyMsg = '🍫 少し休憩しようね…';
          }

          await interaction.reply({
            content: replyMsg,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply({
          flags: CHOCO_REPLY_EPHEMERAL ? MessageFlags.Ephemeral : 0,
        });

        const result = await pickChocoImage();
        if (!result.ok) {
          await interaction.editReply(
            `🍫 画像を用意できなかったよ。\n原因: ${result.reason}`
          );
          logger.warn('choco.slash.no_image', { reason: result.reason });
          return;
        }

        const { fullPath, size, fileName } = result.file;
        const attachment = new AttachmentBuilder(fullPath, { name: fileName });

        await interaction.editReply({
          content: `🍫 choco! (${fileName} / ${mb(size).toFixed(2)}MB)`,
          files: [attachment],
        });

        logger.info('choco.slash.sent', {
          fileName,
          guildId: interaction.guild?.id,
          channelId: interaction.channelId,
          userId: interaction.user?.id,
        });
      } catch (err) {
        logger.error('choco.slash.error', { 
          userId: interaction.user?.id,
          guildId: interaction.guild?.id,
          err: err?.message, 
          stack: err?.stack 
        });

        const msg = '⚠️ エラーになったよ。フォルダのパスや権限を確認してね。';
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: msg });
          } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
          }
        } catch (e) {
          logger.warn('choco.slash.fallback.fail', { err: e?.message });
        }
      }
    });

    // メンション + キーワード
    client.on(Events.MessageCreate, async (message) => {
      try {
        if (message.author?.bot) return;

        const mentioned = message.mentions?.users?.has(client.user.id);
        if (!mentioned) return;

        if (!hasChocoKeyword(message.content)) return;

        const userId = message.author?.id;
        if (!userId) return;

        const meta = {
          userId,
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
        };

        // スパムチェック
        const filterResult = checkRequest(userId, message.content);
        if (!filterResult.allowed) {
          logger.warn('choco.mention.filtered', { 
            ...meta, 
            reason: filterResult.reason 
          });

          let replyMsg = '🍫 ちょっとだけ待ってね';
          if (filterResult.reason === 'banned') {
            replyMsg = '🍫 少し休憩しようね…';
          }

          await message.reply(replyMsg);
          return;
        }

        // ✅ Typing表示
        await sendTypingSafe(message.channel, meta);

        const result = await pickChocoImage();
        if (!result.ok) {
          await message.reply(`🍫 画像を用意できなかったよ。\n原因: ${result.reason}`);
          logger.warn('choco.mention.no_image', { ...meta, reason: result.reason });
          return;
        }

        const { fullPath, fileName } = result.file;
        const attachment = new AttachmentBuilder(fullPath, { name: fileName });

        await message.reply({ content: '🍫 choco!', files: [attachment] });

        logger.info('choco.mention.sent', {
          ...meta,
          fileName,
        });
      } catch (err) {
        logger.error('choco.mention.error', { 
          userId: message.author?.id,
          guildId: message.guildId,
          err: err?.message,
          stack: err?.stack
        });

        try {
          await message.reply('🍫 エラーが発生したよ…');
        } catch (e) {
          logger.warn('choco.mention.fallback.fail', { err: e?.message });
        }
      }
    });

    logger.info('choco.feature.setup.complete', { dir: CHOCO_DIR });
  },
};
