// src/features/welcome/index.js
const { Events } = require('discord.js');
const { logger } = require('../../services/logger');
const { welcomeNewUser, shouldSendWelcome } = require('./welcomeHandler');
// const { notifyVCJoin } = require('./vcNotifyHandler'); // ★VC通知機能は一時凍結
const { getTargetsForGuild } = require('../../config/target');

module.exports = {
  name: 'welcome',
  description: 'Welcome messages for new members',

  enabled: () => {
    const { isFeatureEnabled } = require('../../utils/featureConfig');
    return isFeatureEnabled('welcome');
  },

  async setup(client) {
    logger.info('welcome.feature.setup', {
      vcNotifyEnabled: false, // ★VC通知機能は一時凍結
    });

    // 機能1: 初心者歓迎メッセージ（リプライ機能）
    client.on(Events.MessageCreate, async (message) => {
      try {
        if (!message) return;
        if (message.author?.bot) return;
        if (!message.guildId) return; // DM除外

        // guildId から対応する設定を取得（本番/テスト自動判別）
        const t = getTargetsForGuild(message.guildId);
        if (!t) return; // 管理対象外のサーバーは無視

        if (String(message.channelId) !== String(t.welcomeChannelId)) return;
        if (message.reference) return; // リプライには反応しない

        const raw = String(message.content || '');
        if (!raw) return;

        const userId = String(message.author.id);
        const isTestUser = t.testUserIds.includes(userId);

        // 参加から14日以上経過していたらスキップ（テストユーザーは除外）
        if (!isTestUser && message.member?.joinedTimestamp) {
          const joinElapsed = Date.now() - message.member.joinedTimestamp;
          const fourteenDays = 14 * 24 * 60 * 60 * 1000;
          if (joinElapsed >= fourteenDays) {
            logger.info('welcome.message.skip.too_old', {
              userId,
              joinDays: Math.floor(joinElapsed / (1000 * 60 * 60 * 24)),
              env: t.env,
            });
            return;
          }
        }

        const content = raw.toLowerCase();
        // 「入った」「参加」は誤検知が多いため、より限定的な挨拶パターンのみに絞る
        // NG例: 「3月に入ったので定例会を〜」「参加メンバーを〜」
        const hasWelcomeKeyword =
          content.includes('はじめまして') ||
          content.includes('初めまして') ||
          content.includes('始めまして') ||
          content.includes('よろしくお願い') ||
          content.includes('入りました') ||
          content.includes('参加しました') ||
          content.includes('加入しました') ||
          content.includes('よろしくです') ||
          content.includes('よろしくね');

        if (!hasWelcomeKeyword) return;

        const guildId = String(message.guildId);

        if (!isTestUser && !shouldSendWelcome(userId, guildId)) {
          logger.debug('welcome.message.skip.already', { userId, guildId });
          return;
        }

        logger.info('welcome.message.trigger', {
          userId,
          username: message.author.tag,
          guildId,
          channelId: message.channelId,
          env: t.env,
          isTestUser,
        });

        await welcomeNewUser(message, isTestUser);
      } catch (err) {
        logger.error('welcome.message.error', {
          err: err?.message,
          stack: err?.stack,
        });
      }
    });

    // ★★★ 機能2: 初心者VC参加通知 - 一時凍結 ★★★
    //
    // 再開する場合:
    // 1. 先頭の notifyVCJoin の import コメントを解除
    // 2. 以下のブロックのコメントを解除
    //
    /*
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      try {
        if (oldState.channelId || !newState.channelId) return;

        const t = getTargetsForGuild(newState.guild?.id);
        if (!t) return;

        if (!t.targetVCIds.includes(String(newState.channelId))) return;

        const member = newState.member;
        if (!member?.user) return;
        if (!member.joinedTimestamp) return;

        const joinElapsed = Date.now() - member.joinedTimestamp;
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        const isTestUser = t.testUserIds.includes(String(member.id));

        if (!isTestUser && joinElapsed >= fourteenDays) return;

        logger.info('welcome.vc_notify.trigger', {
          userId: member.user.id,
          vcChannelId: newState.channelId,
          env: t.env,
        });

        await notifyVCJoin(newState, t.guideRoleId, t.notificationChannelId);
      } catch (err) {
        logger.error('welcome.vc_notify.error', { err: err?.message, stack: err?.stack });
      }
    });
    */

    logger.info('welcome.feature.setup.complete');
  },

  async teardown() {
    const { closeDb } = require('./db');
    closeDb();
  },
};
