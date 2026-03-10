// src/features/welcome/db.js
const Database = require('better-sqlite3');
const path = require('path');
const { logger } = require('../../services/logger');

const DB_PATH = process.env.WELCOME_DB_PATH || './data/welcome.sqlite';

let db = null;

/**
 * データベース初期化
 */
function initDb() {
  if (db) return db;

  db = new Database(DB_PATH);

  // welcome_history テーブル作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS welcome_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      welcomed_at INTEGER NOT NULL,
      UNIQUE(user_id, guild_id)
    )
  `);

  // インデックス作成
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_welcome_user_guild 
    ON welcome_history(user_id, guild_id)
  `);

  logger.info('welcome.db.initialized', { path: DB_PATH });

  return db;
}

/**
 * データベースインスタンスを取得
 */
function getDb() {
  if (!db) {
    return initDb();
  }
  return db;
}

/**
 * データベースを閉じる
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('welcome.db.closed');
  }
}

module.exports = {
  initDb,
  getDb,
  closeDb,
};
