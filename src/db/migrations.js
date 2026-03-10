// src/db/migrations.js
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function openDb(dbPath) {
  ensureDir(dbPath);
  return new sqlite3.Database(dbPath);
}

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function all(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function addColumnIfMissing(db, tableName, columnDef) {
  const columnName = columnDef.trim().split(/\s+/)[0];
  const rows = await all(db, `PRAGMA table_info(${tableName});`);
  const hasColumn = rows.some((r) => String(r.name) === String(columnName));
  if (hasColumn) return false;

  await run(db, `ALTER TABLE ${tableName} ADD COLUMN ${columnDef};`);
  return true;
}

async function migrate(dbPath) {
  const db = openDb(dbPath);

  await run(db, `PRAGMA journal_mode = WAL;`);
  await run(db, `PRAGMA foreign_keys = ON;`);

  // ── やみちゃん会話 ──────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS users (
      user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
      nickname_mode INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, guild_id));`);

  await run(db, `CREATE TABLE IF NOT EXISTS conversation_state (
      user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
      last_topic_hint TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, guild_id));`);

  await run(db, `CREATE TABLE IF NOT EXISTS conversation_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_turns_user_guild_time
    ON conversation_turns (user_id, guild_id, created_at DESC);`);

  // ── ServerStats: 時系列ログ ─────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS server_stats_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
      recorded_at INTEGER NOT NULL, all_members INTEGER NOT NULL DEFAULT 0,
      members INTEGER NOT NULL DEFAULT 0, bots INTEGER NOT NULL DEFAULT 0,
      online INTEGER NOT NULL DEFAULT 0, vc_total INTEGER NOT NULL DEFAULT 0,
      vc_talking INTEGER NOT NULL DEFAULT 0, vc_listening INTEGER NOT NULL DEFAULT 0,
      vc_watching INTEGER NOT NULL DEFAULT 0);`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_stats_log_guild_time
    ON server_stats_log (guild_id, recorded_at DESC);`);

  // ── ServerStats: 新規メンバー参加ログ ──────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS member_join_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL, joined_at INTEGER NOT NULL);`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_member_join_guild_time
    ON member_join_log (guild_id, joined_at DESC);`);

  // ── ServerStats: キーワードトレンド ────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS keyword_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
      recorded_at INTEGER NOT NULL, word TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1);`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_keyword_log_guild_time
    ON keyword_log (guild_id, recorded_at DESC);`);

  // ── ServerStats: 統計EmbedのメッセージID永続化 ─────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS stats_message_ids (
      guild_id TEXT NOT NULL PRIMARY KEY, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL, updated_at INTEGER NOT NULL);`);

  // ── ServerStats: 今日の一言メッセージID（ServerStatsと共存） ───────
  await run(db, `CREATE TABLE IF NOT EXISTS daily_word_message_ids (
      guild_id TEXT NOT NULL PRIMARY KEY, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL, posted_date TEXT NOT NULL, updated_at INTEGER NOT NULL);`);

  // ── ServerStats: 先週のまとめメッセージID ─────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS weekly_report_message_ids (
      guild_id TEXT NOT NULL PRIMARY KEY, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL, updated_at INTEGER NOT NULL);`);

  // ── ServerStats: 累計まとめメッセージID ───────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS cumulative_report_message_ids (
      guild_id TEXT NOT NULL PRIMARY KEY, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL, updated_at INTEGER NOT NULL);`);

  // ── VC セッション: 再起動跨ぎチェックポイント ──────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS vc_session_checkpoints (
      user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL, speak_time INTEGER NOT NULL DEFAULT 0,
      is_muted INTEGER NOT NULL DEFAULT 0, is_deafened INTEGER NOT NULL DEFAULT 0,
      last_mute_change INTEGER NOT NULL, saved_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, guild_id));`);

  // ── VC 日次集計（常連スコア計算・週次レポート用） ───────────────────
  // analytics廃止後もserverstatsがVC集計に使う。vc_room_countは異なる部屋参加数。
  await run(db, `CREATE TABLE IF NOT EXISTS user_activity_daily (
      date TEXT NOT NULL, user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0, char_count INTEGER NOT NULL DEFAULT 0,
      emoji_count INTEGER NOT NULL DEFAULT 0,
      vc_total_minutes REAL NOT NULL DEFAULT 0, vc_active_minutes REAL NOT NULL DEFAULT 0,
      vc_join_count INTEGER NOT NULL DEFAULT 0, vc_room_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, user_id, guild_id));`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_activity_guild_date
    ON user_activity_daily (guild_id, date DESC);`);

  // 既存DBの後方互換: CREATE TABLE IF NOT EXISTS では列追加されないため補完
  await addColumnIfMissing(db, 'user_activity_daily', 'vc_join_count INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'user_activity_daily', 'vc_room_count INTEGER NOT NULL DEFAULT 0');

  // ── 絵文字使用統計（週次レポート用） ───────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS emoji_usage (
      date TEXT NOT NULL, guild_id TEXT NOT NULL, emoji TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, guild_id, emoji));`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_emoji_usage_guild_date
    ON emoji_usage (guild_id, date DESC);`);

  // ── VC 呼び水通知クールダウン ───────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS vc_notify_cooldowns (
      guild_id TEXT NOT NULL PRIMARY KEY, notified_at INTEGER NOT NULL);`);

  // ── VC 通知メッセージID（更新用） ────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS vc_notify_message_ids (
      guild_id TEXT NOT NULL PRIMARY KEY, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL, updated_at INTEGER NOT NULL);`);

  // ── VC 入室ログ（タイムスタンプ・出入り回数表示用） ─────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS vc_entry_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL, user_id TEXT NOT NULL, entered_at INTEGER NOT NULL);`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_vc_entry_guild_channel_time
    ON vc_entry_log (guild_id, channel_id, entered_at DESC);`);

  // ── Omikuji: 抽選履歴（連続大凶ペナルティ判定用） ──────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS omikuji_draw_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      fortune_id TEXT NOT NULL,
      drawn_at INTEGER NOT NULL
    );`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_omikuji_user_time
    ON omikuji_draw_history (guild_id, user_id, drawn_at DESC);`);

  db.close();
}

module.exports = { migrate };
