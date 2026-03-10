// src/features/yami/index.js
const { Events, MessageFlags } = require('discord.js');
const { logger } = require('../../services/logger');
const { checkRequest } = require('../../services/contentFilter');
const { handleYamiCommand, handleYamiText } = require('./handlers');
const { handleHelpCommand } = require('../../commands/help');
const { handleSettingsCommand } = require('../../commands/settings');

const path = require('path');
const _rawYamiDb = process.env.DATABASE_PATH || './data/yami.sqlite';
const DB_PATH = path.isAbsolute(_rawYamiDb)
  ? _rawYamiDb
  : path.resolve(__dirname, '..', '..', '..', _rawYamiDb);

// リプライチェーンの追跡
const replyChains = new Map();
const CHAIN_TIMEOUT_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [messageId, data] of replyChains.entries()) {
    if (now - data.timestamp > CHAIN_TIMEOUT_MS) {
      replyChains.delete(messageId);
    }
  }
}, 60000);

function extractCall(message, botUser) {
  const content = (message.content || '').trim();

  // ① Discord公式のメンションオブジェクトで判定（PCもスマホも#3221不要で安定）
  const isMentioned = message.mentions?.has(botUser);
  if (isMentioned) {
    // メンション部分（<@ID> or <@!ID>）を除いた残りをテキストとして返す
    const cleaned = content
      .replace(/<@!?\d+>/g, '')
      .trim();
    return cleaned; // 空文字でも「呼ばれた」ことは確定なので空文字を返す
  }

  // ② テキストプレフィックス（yami/やみ/やみちゃん）
  if (!content) return null;
  const lower = content.toLowerCase();
  const prefixes = ['yami ', 'やみ ', 'やみちゃん '];
  for (const p of prefixes) {
    if (lower.startsWith(p)) return content.slice(p.length).trim();
  }
  return null;
}

function checkReplyChain(message) {
  if (!message.reference?.messageId) return null;

  const replyToId = message.reference.messageId;
  const chainData = replyChains.get(replyToId);
  if (!chainData) return null;

  if (chainData.userId === message.author.id && chainData.guildId === message.guildId) {
    logger.debug('yami.reply_chain.detected', {
      userId: message.author.id,
      guildId: message.guildId,
      replyToId,
    });
    return {
      isReplyChain: true,
      userText: (message.content || '').trim(),
    };
  }

  logger.debug('yami.reply_chain.ignored', {
    expectedUserId: chainData.userId,
    actualUserId: message.author.id,
    replyToId,
  });
  return null;
}

function registerReplyChain(botMessageId, userId, guildId) {
  replyChains.set(botMessageId, {
    userId,
    guildId,
    timestamp: Date.now(),
  });

  logger.debug('yami.reply_chain.registered', {
    botMessageId,
    userId,
    guildId,
  });
}

async function safeReplyOrSend(message, content, meta = {}) {
  const payload = { content, allowedMentions: { repliedUser: false } };

  try {
    const res = await message.reply(payload);
    if (res && res.id) {
      registerReplyChain(res.id, message.author.id, message.guildId);
    }
    logger.info('yami.send.reply.ok', { ...meta, botMessageId: res?.id });
    return res;
  } catch (e) {
    logger.warn('yami.send.reply.fail', {
      ...meta,
      err: e?.message,
      code: e?.code,
      status: e?.status,
    });
  }

  try {
    const res = await message.channel.send(payload);
    if (res && res.id) {
      registerReplyChain(res.id, message.author.id, message.guildId);
    }
    logger.info('yami.send.channel.ok', { ...meta, botMessageId: res?.id });
    return res;
  } catch (e) {
    logger.error('yami.send.channel.fail', {
      ...meta,
      err: e?.message,
      code: e?.code,
      status: e?.status,
    });
  }

  return null;
}

async function sendTypingSafe(channel, meta = {}) {
  try {
    await channel.sendTyping();
    logger.debug('yami.typing.sent', meta);
  } catch (e) {
    logger.warn('yami.typing.fail', { ...meta, err: e?.message, code: e?.code });
  }
}

module.exports = {
  name: 'yami',
  description: 'AI chat feature with Yami persona',

  enabled: () => {
    if (!process.env.GEMINI_API_KEY) {
      return false;
    }
    const { isFeatureEnabled } = require('../../utils/featureConfig');
    return isFeatureEnabled('yami');
  },

  async setup(client) {
    // スラッシュコマンド: /yami, /yamihelp, /yamisettings
    client.on(Events.InteractionCreate, async (interaction) => {
      const requestId = logger.makeRequestId();

      try {
        if (!interaction.isChatInputCommand()) return;
        
        const commandName = interaction.commandName;
        if (!['yami', 'yamihelp', 'yamisettings'].includes(commandName)) return;

        const userId = interaction.user?.id;
        if (!userId) return;

        logger.info('yami.call.slash', {
          requestId,
          userId,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          command: commandName,
        });

        // yamihelp
        if (commandName === 'yamihelp') {
          const helpText = handleHelpCommand();
          await interaction.reply({
            content: helpText,
            flags: MessageFlags.Ephemeral,
          });
          logger.info('yami.help.ok', { requestId });
          return;
        }

        // yamisettings
        if (commandName === 'yamisettings') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          
          const settingsText = await handleSettingsCommand(interaction, {
            dbPath: DB_PATH,
          });
          
          await interaction.editReply(settingsText);
          logger.info('yami.settings.ok', { requestId });
          return;
        }

        // yami (メイン会話)
        const filterResult = checkRequest(userId, '');
        if (!filterResult.allowed) {
          logger.warn('yami.slash.filtered', {
            requestId,
            userId,
            reason: filterResult.reason,
          });

          let replyMsg = 'ごめんね、今は対応できないの…';
          if (filterResult.reason === 'banned') replyMsg = '少し休憩しようね…🌙';
          else if (filterResult.reason === 'cooldown') replyMsg = 'ちょっとだけ待ってね💭';

          await interaction.reply({
            content: replyMsg,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const text = await handleYamiCommand(interaction, {
          dbPath: DB_PATH,
          requestId,
        });

        const safe = text.length > 1900 ? text.slice(0, 1900) + '…' : text;

        await interaction.editReply(safe);
        logger.info('yami.send.slash.ok', { requestId });
      } catch (err) {
        logger.error('yami.call.slash.error', {
          requestId,
          userId: interaction.user?.id,
          guildId: interaction.guildId,
          command: interaction.commandName,
          err: err?.message,
          stack: err?.stack,
        });

        const fallback = 'ごめん、ちょっとだけ転んだ…でも、やみはここにいるよ🌙';
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(fallback);
          } else {
            await interaction.reply({
              content: fallback,
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch (e) {
          logger.error('yami.send.slash.fallback.fail', {
            requestId,
            err: e?.message,
          });
        }
      }
    });

    // テキストメッセージ応答
    client.on(Events.MessageCreate, async (message) => {
      const requestId = logger.makeRequestId();

      try {
        if (!message || message.author?.bot) return;
        if (!message.guildId) return;

        const botUser = client.user;
        const userId = message.author.id;
        const content = (message.content || '').trim();

        // リプライチェーン（優先）
        const replyChainResult = checkReplyChain(message);
        if (replyChainResult) {
          const userText = replyChainResult.userText || '';

          const meta = {
            requestId,
            userId,
            guildId: message.guildId,
            channelId: message.channelId,
            messageId: message.id,
            isReplyChain: true,
            replyToId: message.reference.messageId,
          };

          logger.info('yami.call.reply_chain', {
            ...meta,
            contentPreview: userText.slice(0, 120),
          });

          const filterResult = checkRequest(userId, userText);
          if (!filterResult.allowed) {
            logger.warn('yami.reply_chain.filtered', {
              ...meta,
              reason: filterResult.reason,
            });

            let replyMsg = 'ごめんね、今は対応できないの…';
            if (filterResult.reason === 'banned') replyMsg = '少し休憩しようね…🌙';
            else if (filterResult.reason === 'cooldown') replyMsg = 'ちょっとだけ待ってね💭';
            else if (filterResult.reason === 'banned_word') replyMsg = 'その言葉は使わないでね…';
            else if (filterResult.reason === 'suspicious_url') replyMsg = 'そのリンクは開けないよ…';

            await safeReplyOrSend(message, replyMsg, meta);
            return;
          }

          await sendTypingSafe(message.channel, meta);

          const out = await handleYamiText({
            dbPath: DB_PATH,
            guildKey: message.guildId,
            userId,
            userText,
            requestId,
          });

          const safe = out.length > 1900 ? out.slice(0, 1900) + '…' : out;
          await safeReplyOrSend(message, safe, meta);
          return;
        }

        // 通常のメンション・プレフィックス検出
        const calledText = extractCall(message, botUser);
        if (calledText === null) return;

        const userText = calledText || '';

        const meta = {
          requestId,
          userId,
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          isReply: !!message.reference?.messageId,
        };

        logger.info('yami.call.text', {
          ...meta,
          contentPreview: (message.content || '').slice(0, 120),
        });

        const filterResult = checkRequest(userId, userText);
        if (!filterResult.allowed) {
          logger.warn('yami.text.filtered', {
            ...meta,
            reason: filterResult.reason,
          });

          let replyMsg = 'ごめんね、今は対応できないの…';
          if (filterResult.reason === 'banned') replyMsg = '少し休憩しようね…🌙';
          else if (filterResult.reason === 'cooldown') replyMsg = 'ちょっとだけ待ってね💭';
          else if (filterResult.reason === 'banned_word') replyMsg = 'その言葉は使わないでね…';
          else if (filterResult.reason === 'suspicious_url') replyMsg = 'そのリンクは開けないよ…';

          await safeReplyOrSend(message, replyMsg, meta);
          return;
        }

        await sendTypingSafe(message.channel, meta);

        const out = await handleYamiText({
          dbPath: DB_PATH,
          guildKey: message.guildId,
          userId,
          userText,
          requestId,
        });

        const safe = out.length > 1900 ? out.slice(0, 1900) + '…' : out;

        await safeReplyOrSend(message, safe, meta);
      } catch (err) {
        logger.error('yami.call.text.error', {
          requestId,
          guildId: message?.guildId,
          channelId: message?.channelId,
          messageId: message?.id,
          userId: message?.author?.id,
          err: err?.message,
          stack: err?.stack,
        });

        try {
          if (message?.guildId) {
            await safeReplyOrSend(
              message,
              'ごめん、ちょっとだけ転んだ…でも、やみはここにいるよ🌙',
              {
                requestId,
                guildId: message.guildId,
                channelId: message.channelId,
              }
            );
          }
        } catch (e) {
          logger.error('yami.send.text.fallback.fail', {
            requestId,
            err: e?.message,
          });
        }
      }
    });

    logger.info('yami.feature.setup.complete');
  },
};
