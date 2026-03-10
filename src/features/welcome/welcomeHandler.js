// src/features/welcome/welcomeHandler.js
const { logger } = require('../../services/logger');
const { generateWelcomeMessage } = require('./geminiService');
const { getDb } = require('./db');

/**
 * ユーザーが既に歓迎メッセージを受け取っているかチェック
 */
function hasReceivedWelcome(userId, guildId) {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT id FROM welcome_history
    WHERE user_id = ? AND guild_id = ?
  `);

  const row = stmt.get(userId, guildId);
  return row !== undefined;
}

/**
 * 歓迎履歴を記録
 */
function recordWelcome(userId, guildId) {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO welcome_history (user_id, guild_id, welcomed_at)
    VALUES (?, ?, ?)
  `);

  stmt.run(userId, guildId, Date.now());
}

/**
 * 歓迎メッセージを送信すべきか判定
 */
function shouldSendWelcome(userId, guildId) {
  return !hasReceivedWelcome(userId, guildId);
}

// 処理中のユーザー/メッセージを一時的に記録（重複防止）
// グローバル変数を使って、モジュールが二重に読み込まれても共有できるようにする
if (!global.welcomeProcessingSet) {
  global.welcomeProcessingSet = new Set();
}
const processingSet = global.welcomeProcessingSet;

/**
 * 歓迎メッセージを生成して送信
 */
async function welcomeNewUser(message, isTestUser = false) {
  const userId = String(message.author?.id);
  const guildId = String(message.guildId);
  const messageId = String(message.id);

  // 重複チェック (グローバルメモリ内)
  const dedupKey = `welcome:${guildId}:${userId}:${messageId}`;
  if (processingSet.has(dedupKey)) {
    logger.warn('welcome.message.duplicate_detected', {
      dedupKey,
      pid: process.pid
    });
    return;
  }

  // ロック取得 (10秒間有効)
  processingSet.add(dedupKey);
  setTimeout(() => processingSet.delete(dedupKey), 10000);

  // displayNameは author には基本無いので member を優先
  const username =
    message.member?.displayName ||
    message.author?.globalName ||
    message.author?.username ||
    '名無しさん';

  try {
    // Typing表示
    try {
      await message.channel.sendTyping();
    } catch (_) { }

    // Geminiで歓迎メッセージ生成
    const welcomeText = await generateWelcomeMessage(username, message.content);

    // リプライ（メンション暴発を避ける）
    await message.reply({
      content: welcomeText,
      allowedMentions: { repliedUser: false },
    });

    // テストユーザー以外は履歴記録
    if (!isTestUser) {
      recordWelcome(userId, guildId);
    }

    logger.info('welcome.message.sent', {
      userId,
      username,
      guildId,
      isTestUser,
      length: welcomeText.length,
      pid: process.pid,
    });
  } catch (err) {
    logger.error('welcome.message.send_error', {
      userId,
      err: err?.message,
      stack: err?.stack,
    });

    // フォールバック
    try {
      await message.reply({
        content:
          `ようこそ、${username}さん！🎉\n` +
          `このサーバーを楽しんでくださいね。困ったことがあればいつでも質問してください！`,
        allowedMentions: { repliedUser: false },
      });
    } catch (fallbackErr) {
      logger.error('welcome.message.fallback_error', {
        err: fallbackErr?.message,
      });
    }
  }
}

module.exports = {
  shouldSendWelcome,
  welcomeNewUser,
  hasReceivedWelcome,
  recordWelcome,
};
