// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { logger } = require('./services/logger');
const { loadFeatures } = require('./core/featureLoader');

// Discord Client設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,    // 将来の音声系機能で必要
    GatewayIntentBits.GuildMembers,        // ServerStats, Boostで必要
    GatewayIntentBits.GuildPresences,      // ServerStats: オンライン人数検知に必要
    GatewayIntentBits.GuildMessageReactions, // DiaryReaction, 将来用
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.Thread],
});

// Graceful shutdown用フラグ
let isShuttingDown = false;

// グローバルエラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
  logger.error('process.unhandledRejection', {
    reason: String(reason),
    promise: String(promise)
  });
});

process.on('uncaughtException', (err) => {
  logger.error('process.uncaughtException', {
    err: err?.message,
    stack: err?.stack
  });
  // 致命的エラーの場合は終了
  gracefulShutdown('uncaughtException');
});

// Graceful shutdown処理
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('shutdown.already_in_progress', { signal });
    return;
  }

  isShuttingDown = true;
  logger.info('shutdown.start', { signal });

  try {
    // Discord接続を閉じる
    if (client && client.user) {
      logger.info('shutdown.discord.closing');
      await client.destroy();
      logger.info('shutdown.discord.closed');
    }

    // その他のクリーンアップ処理があればここに追加

    logger.info('shutdown.complete', { signal });
    process.exit(0);
  } catch (err) {
    logger.error('shutdown.error', {
      err: err?.message,
      stack: err?.stack
    });
    process.exit(1);
  }
}

// シグナルハンドリング
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// PM2からのshutdownメッセージ
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    gracefulShutdown('PM2_SHUTDOWN');
  }
});

// 起動処理
(async () => {
  try {
    logger.info('bot.startup.begin');

    // DBマイグレーション（テーブルが存在しない場合のみ作成）
    const { migrate } = require('./db/migrations');
    const path = require('path');
    const projectRoot = path.resolve(__dirname, '..');

    // ── メインDB（analytics / serverstats 等）
    const rawDbPath = process.env.ANALYTICS_DB_PATH || process.env.YAMICHAN_DB_PATH;
    const dbPath = rawDbPath
      ? (path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath))
      : path.join(projectRoot, 'data', 'yamichan.db');
    await migrate(dbPath);
    logger.info('bot.db.migrated', { dbPath });

    // ── yami専用DB（DATABASE_PATH）が別ファイルを指している場合も migrate を実行
    //    yami は users / conversation_state / conversation_turns を使うため、
    //    テーブルが存在しないと SQLITE_ERROR: no such table になる
    const rawYamiPath = process.env.DATABASE_PATH;
    if (rawYamiPath) {
      const yamiDbPath = path.isAbsolute(rawYamiPath)
        ? rawYamiPath
        : path.resolve(projectRoot, rawYamiPath);
      if (yamiDbPath !== dbPath) {
        await migrate(yamiDbPath);
        logger.info('bot.db.migrated_yami', { yamiDbPath });
      }
    }

    // 機能を読み込み
    const features = await loadFeatures(client);
    logger.info('bot.features.loaded', {
      count: features.length,
      features: features.map(f => f.name)
    });

    // Discordにログイン
    await client.login(process.env.DISCORD_TOKEN);

    client.once(Events.ClientReady, () => {
      logger.info('bot.ready', {
        tag: client.user.tag,
        id: client.user.id,
        guilds: client.guilds.cache.size
      });
    });

    // Discord接続エラー
    client.on('error', (err) => {
      logger.error('bot.discord.error', {
        err: err?.message,
        stack: err?.stack
      });
    });

    // Discord切断警告
    client.on('warn', (info) => {
      logger.warn('bot.discord.warn', { info });
    });

    // Discord再接続
    client.on('shardReconnecting', (id) => {
      logger.warn('bot.discord.reconnecting', { shardId: id });
    });

  } catch (err) {
    logger.error('bot.startup.failed', {
      err: err?.message,
      stack: err?.stack
    });
    process.exit(1);
  }
})();
