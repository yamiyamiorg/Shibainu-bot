// src/features/oyaji/oyajiDb.js
//
// おやじBot 専用 DB 操作（better-sqlite3）。
//
// ── 再起動フェイルセーフ設計 ──────────────────────────────────────
//
//  問題: Bot 再起動時に _sessionMeta（インメモリ）が消える。
//        DB 上の status='active' セッションが宙吊りになる。
//        → 再起動後に /oyaji start が「もうセッションある」と弾かれる。
//
//  解決策: setup() 起動時に recoverSessionsOnBoot() を呼ぶ。
//
//  recoverSessionsOnBoot(client) の動作:
//    1. DB から status='active' のセッションを全件取得
//    2. 各セッションの VoiceChannel を Discord から実際に確認
//    3a. VC が存在 かつ オーナーがまだいる → restarted_at を更新して継続
//    3b. VC が存在しない / オーナーがいない → status='orphaned' に変更
//    3c. last_tick_at が STALE_THRESHOLD 以上前 → status='stale' に変更
//
//  status 一覧:
//    'active'   - 正常稼働中
//    'ended'    - 正常終了
//    'orphaned' - 再起動時にオーナー不在と判明
//    'stale'    - 再起動時に長時間放置と判明

'use strict';

const path = require('path');
const BetterSqlite = require('better-sqlite3');
const { logger } = require('../../services/logger');
const { calcRankFromMinutes, getLifeStage } = require('./rankSystem');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'oyaji.db');

// 再起動時に STALE とみなす閾値（ms）
// last_tick_at がこれ以上古ければ孤立扱い
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30分

// ── DB 接続（シングルトン）────────────────────────────────────────

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

// ── マイグレーション ───────────────────────────────────────────────

function migrateOyaji(db) {
  // ── oyaji_profiles ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS oyaji_profiles (
      guild_id         TEXT    NOT NULL,
      user_id          TEXT    NOT NULL,
      total_minutes    INTEGER NOT NULL DEFAULT 0,
      current_rank     INTEGER NOT NULL DEFAULT 1,
      current_stage    TEXT    NOT NULL DEFAULT 'childhood',
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // ── oyaji_sessions ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS oyaji_sessions (
      session_id        TEXT    NOT NULL PRIMARY KEY,
      guild_id          TEXT    NOT NULL,
      voice_channel_id  TEXT    NOT NULL,
      text_channel_id   TEXT    NOT NULL,
      thread_channel_id TEXT,
      owner_user_id     TEXT    NOT NULL,
      started_at        INTEGER NOT NULL,
      last_tick_at      INTEGER NOT NULL,
      current_rank      INTEGER NOT NULL DEFAULT 1,
      current_stage     TEXT    NOT NULL DEFAULT 'childhood',
      status            TEXT    NOT NULL DEFAULT 'active',
      restarted_at      INTEGER,
      UNIQUE (guild_id, voice_channel_id)
    );
  `);

  // 既存 DB の後方互換: restarted_at が無い場合に追加
  const sessionCols = db.pragma('table_info(oyaji_sessions)').map((r) => r.name);
  if (!sessionCols.includes('restarted_at')) {
    db.exec(`ALTER TABLE oyaji_sessions ADD COLUMN restarted_at INTEGER;`);
    logger.info('oyaji.db.migrate.added_restarted_at');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oyaji_sessions_guild
      ON oyaji_sessions (guild_id, status);
  `);

  // ── oyaji_memories ──────────────────────────────────────────────
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

  // ── oyaji_interactions ──────────────────────────────────────────
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oyaji_interactions_user
      ON oyaji_interactions (user_id, created_at DESC);
  `);
}

// ── 再起動フェイルセーフ ────────────────────────────────────────────

/**
 * Bot 起動時に呼ぶ。
 * DB 上の active セッションを Discord の実態と照合し、
 * 孤立・陳腐化したセッションを適切に閉じる。
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

  let recovered = 0;
  let orphaned  = 0;
  let stale     = 0;
  const now = Date.now();

  for (const session of activeSessions) {
    const { session_id, guild_id, voice_channel_id, owner_user_id, last_tick_at } = session;

    // ケース1: last_tick_at が STALE_THRESHOLD より古い → 長時間放置
    if (now - last_tick_at > STALE_THRESHOLD_MS) {
      markSessionStale(session_id);
      stale++;
      logger.info('oyaji.boot.session_stale', {
        session_id,
        idle_min: Math.floor((now - last_tick_at) / 60000),
      });
      continue;
    }

    // ケース2: ギルドが見つからない
    const guild = client.guilds.cache.get(guild_id);
    if (!guild) {
      markSessionOrphaned(session_id);
      orphaned++;
      logger.info('oyaji.boot.session_orphaned', { session_id, reason: 'guild_not_found' });
      continue;
    }

    // ケース3: VC が存在しない
    const vc = guild.channels.cache.get(voice_channel_id);
    if (!vc) {
      markSessionOrphaned(session_id);
      orphaned++;
      logger.info('oyaji.boot.session_orphaned', { session_id, reason: 'vc_not_found' });
      continue;
    }

    // ケース4: オーナーが VC にいない
    if (!vc.members.has(owner_user_id)) {
      markSessionOrphaned(session_id);
      orphaned++;
      logger.info('oyaji.boot.session_orphaned', { session_id, reason: 'owner_not_in_vc' });
      continue;
    }

    // ケース5: オーナーがまだ VC にいる → 回復
    getDb()
      .prepare(`UPDATE oyaji_sessions SET restarted_at = ? WHERE session_id = ?`)
      .run(now, session_id);
    recovered++;
    logger.info('oyaji.boot.session_recovered', { session_id, guild_id, voice_channel_id });
  }

  logger.info('oyaji.boot.recovery_done', { recovered, orphaned, stale });
  return { recovered, orphaned, stale };
}

function markSessionOrphaned(sessionId) {
  getDb()
    .prepare(`UPDATE oyaji_sessions SET status = 'orphaned' WHERE session_id = ?`)
    .run(sessionId);
}

function markSessionStale(sessionId) {
  getDb()
    .prepare(`UPDATE oyaji_sessions SET status = 'stale' WHERE session_id = ?`)
    .run(sessionId);
}

// ── oyaji_profiles ─────────────────────────────────────────────────

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
        (guild_id, user_id, total_minutes, current_rank, current_stage, created_at, updated_at)
      VALUES (?, ?, 0, 1, 'childhood', ?, ?)
    `)
    .run(guildId, userId, now, now);

  return getProfile(guildId, userId);
}

function addMinutesAndUpdateRank(guildId, userId, addMinutes = 1) {
  const profile  = getOrCreateProfile(guildId, userId);
  const prevRank = profile.current_rank;
  const newTotal = profile.total_minutes + addMinutes;
  const newRank  = calcRankFromMinutes(newTotal);
  const newStage = getLifeStage(newRank).id;

  getDb()
    .prepare(`
      UPDATE oyaji_profiles
         SET total_minutes = ?, current_rank = ?, current_stage = ?, updated_at = ?
       WHERE guild_id = ? AND user_id = ?
    `)
    .run(newTotal, newRank, newStage, Date.now(), guildId, userId);

  return { rank: newRank, stage: newStage, rankChanged: newRank !== prevRank };
}

// ── oyaji_sessions ─────────────────────────────────────────────────

function getActiveSession(guildId, voiceChannelId) {
  return getDb()
    .prepare(`
      SELECT * FROM oyaji_sessions
       WHERE guild_id = ? AND voice_channel_id = ? AND status = 'active'
    `)
    .get(guildId, voiceChannelId) || null;
}

function startSession({ guildId, voiceChannelId, textChannelId, ownerUserId, threadChannelId }) {
  const existing = getActiveSession(guildId, voiceChannelId);
  if (existing) return null;

  const profile   = getOrCreateProfile(guildId, ownerUserId);
  const now       = Date.now();
  const sessionId = `${guildId}-${voiceChannelId}-${now}`;

  getDb()
    .prepare(`
      INSERT INTO oyaji_sessions
        (session_id, guild_id, voice_channel_id, text_channel_id,
         thread_channel_id, owner_user_id, started_at, last_tick_at,
         current_rank, current_stage, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `)
    .run(
      sessionId, guildId, voiceChannelId, textChannelId,
      threadChannelId || null, ownerUserId,
      now, now, profile.current_rank, profile.current_stage,
    );

  logger.info('oyaji.session.start', {
    sessionId, guildId, voiceChannelId, ownerUserId,
    rank: profile.current_rank, stage: profile.current_stage,
  });

  return getDb()
    .prepare(`SELECT * FROM oyaji_sessions WHERE session_id = ?`)
    .get(sessionId);
}

function endSession(sessionId) {
  getDb()
    .prepare(`UPDATE oyaji_sessions SET status = 'ended' WHERE session_id = ?`)
    .run(sessionId);
  logger.info('oyaji.session.end', { sessionId });
}

function tickSession(sessionId, rank, stage) {
  getDb()
    .prepare(`
      UPDATE oyaji_sessions
         SET last_tick_at = ?, current_rank = ?, current_stage = ?
       WHERE session_id = ?
    `)
    .run(Date.now(), rank, stage, sessionId);
}

// ── oyaji_memories ─────────────────────────────────────────────────

const MAX_MEMORIES = 10;

function writeMemory({ guildId, userId, topicCategory, summary, importance = 1 }) {
  getDb()
    .prepare(`
      INSERT INTO oyaji_memories
        (guild_id, user_id, topic_category, summary, importance, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(guildId, userId, topicCategory, summary, importance, Date.now());

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

function getRecentMemories(guildId, userId, limit = 5) {
  return getDb()
    .prepare(`
      SELECT * FROM oyaji_memories
       WHERE guild_id = ? AND user_id = ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?
    `)
    .all(guildId, userId, limit);
}

// ── oyaji_interactions ─────────────────────────────────────────────

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
  recoverSessionsOnBoot,
  markSessionOrphaned,
  markSessionStale,
  getProfile,
  getOrCreateProfile,
  addMinutesAndUpdateRank,
  getActiveSession,
  startSession,
  endSession,
  tickSession,
  writeMemory,
  getRecentMemories,
  logInteraction,
  getRecentInteractions,
};
