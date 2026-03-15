// src/features/oyaji/oyajiDb.js
//
// おやじBot 専用 DB 操作（better-sqlite3）v2
//
// ── v2 での設計変更 ─────────────────────────────────────────────
//
//  v1: VCセッション単位・rankSystem連動・tickタイマーあり
//  v2: ユーザー個人セッション単位・世代はユーザー選択・tickなし
//
//  テーブル構成:
//    oyaji_profiles    - ユーザーの来訪履歴・選択世代・セッション数
//    oyaji_sessions    - 現在進行中のセッション（ユーザーごと1件）
//    oyaji_memories    - 短期記憶（最大3件）
//    oyaji_interactions - 会話ログ
//
// ── 再起動フェイルセーフ ─────────────────────────────────────────
//
//  recoverSessionsOnBoot(client) を setup() の ClientReady で呼ぶ。
//  - スレッドが存在しない → orphaned
//  - last_interaction_at が STALE_THRESHOLD 以上前 → stale
//  - それ以外 → restarted_at を更新して継続

'use strict';

const path = require('path');
const BetterSqlite = require('better-sqlite3');
const { logger } = require('../../services/logger');

const PROJECT_ROOT   = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'oyaji.db');

// セッションがstaleとみなす閾値（最後の発言からこの時間以上→タイムアウト対象）
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1時間

// ── DB接続（シングルトン）─────────────────────────────────────────

let _db = null;

function getDb() {
  if (_db) return _db;

  const dbPath = (() => {
    const raw = process.env.OYAJI_DB_PATH;
    if (!raw) return DEFAULT_DB_PATH;
    return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  })();

  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = BetterSqlite(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrateOyaji(_db);
  logger.info('oyaji.db.ready', { dbPath });
  return _db;
}

// ── マイグレーション ──────────────────────────────────────────────

function migrateOyaji(db) {

  // ── oyaji_profiles ─────────────────────────────────────────────
  // ユーザーの来訪履歴。世代はユーザーが毎回選ぶが「前回の世代」を保持する。
  db.exec(`
    CREATE TABLE IF NOT EXISTS oyaji_profiles (
      guild_id         TEXT    NOT NULL,
      user_id          TEXT    NOT NULL,
      last_visit_at    INTEGER,
      last_stage       TEXT,
      session_count    INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // ── oyaji_sessions ─────────────────────────────────────────────
  // ユーザーごとに1件のみ。
  // status: 'active' | 'ended' | 'orphaned' | 'stale'
  db.exec(`
    CREATE TABLE IF NOT EXISTS oyaji_sessions (
      session_id           TEXT    NOT NULL PRIMARY KEY,
      guild_id             TEXT    NOT NULL,
      user_id              TEXT    NOT NULL,
      text_channel_id      TEXT    NOT NULL,
      thread_id            TEXT,
      current_stage        TEXT    NOT NULL,
      started_at           INTEGER NOT NULL,
      last_interaction_at  INTEGER NOT NULL,
      status               TEXT    NOT NULL DEFAULT 'active',
      restarted_at         INTEGER,
      UNIQUE (guild_id, user_id, status)
    );
  `);

  // UNIQUE制約が古い形式の場合の後方互換パッチ
  const sessionCols = db.pragma('table_info(oyaji_sessions)').map((r) => r.name);
  if (!sessionCols.includes('restarted_at')) {
    db.exec(`ALTER TABLE oyaji_sessions ADD COLUMN restarted_at INTEGER;`);
    logger.info('oyaji.db.migrate.added_restarted_at');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oyaji_sessions_user
      ON oyaji_sessions (guild_id, user_id, status);
  `);

  // ── oyaji_memories ─────────────────────────────────────────────
  // 最大3件。開始メッセージに自然に混ぜるための短期記憶。
  db.exec(`
    CREATE TABLE IF NOT EXISTS oyaji_memories (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id       TEXT    NOT NULL,
      user_id        TEXT    NOT NULL,
      topic_category TEXT    NOT NULL,
      summary        TEXT    NOT NULL,
      importance     INTEGER NOT NULL DEFAULT 1,
      created_at     INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oyaji_memories_user
      ON oyaji_memories (guild_id, user_id, importance DESC, created_at DESC);
  `);

  // ── oyaji_interactions ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS oyaji_interactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,
      input_text    TEXT    NOT NULL,
      category      TEXT    NOT NULL DEFAULT 'unknown',
      response_text TEXT    NOT NULL,
      used_ai       INTEGER NOT NULL DEFAULT 0,
      template_id   TEXT,
      created_at    INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oyaji_interactions_session
      ON oyaji_interactions (session_id, created_at DESC);
  `);
}

// ── 再起動フェイルセーフ ──────────────────────────────────────────

/**
 * Bot起動時に呼ぶ。
 * DBのactiveセッションをDiscordの実態と照合する。
 *
 * @param {import('discord.js').Client} client
 * @returns {Promise<{ recovered: number, orphaned: number, stale: number }>}
 */
async function recoverSessionsOnBoot(client) {
  const activeSessions = getDb()
    .prepare(`SELECT * FROM oyaji_sessions WHERE status = 'active'`)
    .all();

  if (activeSessions.length === 0) {
    logger.info('oyaji.boot.no_active_sessions');
    return { recovered: 0, orphaned: 0, stale: 0 };
  }

  logger.info('oyaji.boot.recovery_start', { count: activeSessions.length });

  let recovered = 0, orphaned = 0, stale = 0;
  const now = Date.now();

  for (const session of activeSessions) {
    const { session_id, guild_id, thread_id, last_interaction_at } = session;

    // ケース1: last_interaction_at が STALE_THRESHOLD より古い
    if (now - last_interaction_at > STALE_THRESHOLD_MS) {
      _updateSessionStatus(session_id, 'stale');
      stale++;
      logger.info('oyaji.boot.session_stale', {
        session_id, idle_min: Math.floor((now - last_interaction_at) / 60000),
      });
      continue;
    }

    // ケース2: スレッドが存在しない
    if (thread_id) {
      const guild = client.guilds.cache.get(guild_id);
      const thread = guild?.channels.cache.get(thread_id);
      if (!thread) {
        _updateSessionStatus(session_id, 'orphaned');
        orphaned++;
        logger.info('oyaji.boot.session_orphaned', { session_id, reason: 'thread_not_found' });
        continue;
      }
    }

    // ケース3: 回復
    getDb()
      .prepare(`UPDATE oyaji_sessions SET restarted_at = ? WHERE session_id = ?`)
      .run(now, session_id);
    recovered++;
    logger.info('oyaji.boot.session_recovered', { session_id });
  }

  logger.info('oyaji.boot.recovery_done', { recovered, orphaned, stale });
  return { recovered, orphaned, stale };
}

function _updateSessionStatus(sessionId, status) {
  getDb()
    .prepare(`UPDATE oyaji_sessions SET status = ? WHERE session_id = ?`)
    .run(status, sessionId);
}

// ── oyaji_profiles ────────────────────────────────────────────────

function getProfile(guildId, userId) {
  return getDb()
    .prepare(`SELECT * FROM oyaji_profiles WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) || null;
}

function getOrCreateProfile(guildId, userId) {
  const existing = getProfile(guildId, userId);
  if (existing) return existing;

  const now = Date.now();
  getDb()
    .prepare(`
      INSERT INTO oyaji_profiles
        (guild_id, user_id, last_visit_at, last_stage, session_count, created_at, updated_at)
      VALUES (?, ?, NULL, NULL, 0, ?, ?)
    `)
    .run(guildId, userId, now, now);

  return getProfile(guildId, userId);
}

/**
 * セッション開始時にprofileを更新する。
 * @param {string} guildId
 * @param {string} userId
 * @param {string} stage - 選択した世代
 */
function updateProfileOnStart(guildId, userId, stage) {
  getOrCreateProfile(guildId, userId);

  getDb()
    .prepare(`
      UPDATE oyaji_profiles
         SET last_visit_at = ?,
             last_stage    = ?,
             session_count = session_count + 1,
             updated_at    = ?
       WHERE guild_id = ? AND user_id = ?
    `)
    .run(Date.now(), stage, Date.now(), guildId, userId);
}

// ── oyaji_sessions ────────────────────────────────────────────────

/**
 * ユーザーのアクティブセッションを返す。
 */
function getActiveSession(guildId, userId) {
  return getDb()
    .prepare(`
      SELECT * FROM oyaji_sessions
       WHERE guild_id = ? AND user_id = ? AND status = 'active'
    `)
    .get(guildId, userId) || null;
}

/**
 * セッションIDでセッションを取得する。
 */
function getSessionById(sessionId) {
  return getDb()
    .prepare(`SELECT * FROM oyaji_sessions WHERE session_id = ?`)
    .get(sessionId) || null;
}

/**
 * セッションを開始する。
 * 既存のactiveセッションがあれば終了してから新規作成する（世代切替に対応）。
 *
 * @param {object} params
 * @param {string} params.guildId
 * @param {string} params.userId
 * @param {string} params.textChannelId
 * @param {string} params.stage        - 選択した世代ID
 * @param {string} [params.threadId]
 * @returns {object} 作成したセッション
 */
function startSession({ guildId, userId, textChannelId, stage, threadId }) {
  const now       = Date.now();
  const sessionId = `${guildId}-${userId}-${now}`;

  // 既存のactiveセッションを終了（世代切替）
  getDb()
    .prepare(`
      UPDATE oyaji_sessions SET status = 'ended'
       WHERE guild_id = ? AND user_id = ? AND status = 'active'
    `)
    .run(guildId, userId);

  getDb()
    .prepare(`
      INSERT INTO oyaji_sessions
        (session_id, guild_id, user_id, text_channel_id, thread_id,
         current_stage, started_at, last_interaction_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `)
    .run(sessionId, guildId, userId, textChannelId, threadId || null,
        stage, now, now);

  // プロフィール更新
  updateProfileOnStart(guildId, userId, stage);

  logger.info('oyaji.session.start', { sessionId, guildId, userId, stage });

  return getDb()
    .prepare(`SELECT * FROM oyaji_sessions WHERE session_id = ?`)
    .get(sessionId);
}

/**
 * セッションのthread_idを更新する（スレッド生成後に呼ぶ）。
 */
function updateSessionThread(sessionId, threadId) {
  getDb()
    .prepare(`UPDATE oyaji_sessions SET thread_id = ? WHERE session_id = ?`)
    .run(threadId, sessionId);
}

/**
 * セッションのlast_interaction_atを更新する（発言のたびに呼ぶ）。
 */
function touchSession(sessionId) {
  getDb()
    .prepare(`UPDATE oyaji_sessions SET last_interaction_at = ? WHERE session_id = ?`)
    .run(Date.now(), sessionId);
}

/**
 * セッションを終了する。
 */
function endSession(sessionId) {
  getDb()
    .prepare(`UPDATE oyaji_sessions SET status = 'ended' WHERE session_id = ?`)
    .run(sessionId);
  logger.info('oyaji.session.end', { sessionId });
}

/**
 * タイムアウト済みのアクティブセッションを全件返す。
 * タイムアウトチェック用（setIntervalから呼ぶ）。
 *
 * @param {number} timeoutMs
 * @returns {object[]}
 */
function getTimedOutSessions(timeoutMs) {
  const threshold = Date.now() - timeoutMs;
  return getDb()
    .prepare(`
      SELECT * FROM oyaji_sessions
       WHERE status = 'active' AND last_interaction_at < ?
    `)
    .all(threshold);
}

// ── oyaji_memories ────────────────────────────────────────────────

const MAX_MEMORIES = 3; // 仕様: 最大3件

function writeMemory({ guildId, userId, topicCategory, summary, importance = 1 }) {
  getDb()
    .prepare(`
      INSERT INTO oyaji_memories
        (guild_id, user_id, topic_category, summary, importance, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(guildId, userId, topicCategory, summary, importance, Date.now());

  // MAX_MEMORIES超えた分を古い順に削除
  getDb()
    .prepare(`
      DELETE FROM oyaji_memories
       WHERE guild_id = ? AND user_id = ?
         AND id NOT IN (
           SELECT id FROM oyaji_memories
            WHERE guild_id = ? AND user_id = ?
            ORDER BY importance DESC, created_at DESC
            LIMIT ?
         )
    `)
    .run(guildId, userId, guildId, userId, MAX_MEMORIES);
}

function getRecentMemories(guildId, userId) {
  return getDb()
    .prepare(`
      SELECT * FROM oyaji_memories
       WHERE guild_id = ? AND user_id = ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?
    `)
    .all(guildId, userId, MAX_MEMORIES);
}

// ── oyaji_interactions ────────────────────────────────────────────

function logInteraction({ sessionId, userId, inputText, category, responseText, usedAi = false, templateId = null }) {
  getDb()
    .prepare(`
      INSERT INTO oyaji_interactions
        (session_id, user_id, input_text, category, response_text, used_ai, template_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(sessionId, userId, inputText, category, responseText, usedAi ? 1 : 0, templateId, Date.now());
}

function getRecentInteractions(sessionId, limit = 3) {
  return getDb()
    .prepare(`
      SELECT * FROM oyaji_interactions
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?
    `)
    .all(sessionId, limit)
    .reverse();
}

module.exports = {
  getDb,
  STALE_THRESHOLD_MS,
  // boot recovery
  recoverSessionsOnBoot,
  // profiles
  getProfile,
  getOrCreateProfile,
  updateProfileOnStart,
  // sessions
  getActiveSession,
  getSessionById,
  startSession,
  updateSessionThread,
  touchSession,
  endSession,
  getTimedOutSessions,
  // memories
  writeMemory,
  getRecentMemories,
  // interactions
  logInteraction,
  getRecentInteractions,
};
