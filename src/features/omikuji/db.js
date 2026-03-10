// src/features/omikuji/db.js
'use strict';

const path = require('path');
const { openDb } = require('../../db/sqlite');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'yamichan.db');

function resolveDbPath() {
    const raw = process.env.ANALYTICS_DB_PATH || process.env.YAMICHAN_DB_PATH;
    if (!raw) return DEFAULT_DB_PATH;
    return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

function getDb() {
    return openDb(resolveDbPath());
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

async function recordOmikujiDraw(guildId, userId, fortuneId, drawnAt = Math.floor(Date.now() / 1000)) {
    const db = getDb();
    try {
        await run(
            db,
            `INSERT INTO omikuji_draw_history (guild_id, user_id, fortune_id, drawn_at)
             VALUES (?, ?, ?, ?)`,
            [String(guildId), String(userId), String(fortuneId), drawnAt]
        );
    } finally {
        db.close();
    }
}

async function countRecentDaikyo(guildId, userId, withinSeconds = 24 * 60 * 60) {
    const db = getDb();
    const since = Math.floor(Date.now() / 1000) - withinSeconds;
    try {
        const row = await get(
            db,
            `SELECT COUNT(*) AS cnt
             FROM omikuji_draw_history
             WHERE guild_id = ?
               AND user_id = ?
               AND fortune_id = 'daikyo'
               AND drawn_at >= ?`,
            [String(guildId), String(userId), since]
        );
        return row?.cnt ?? 0;
    } finally {
        db.close();
    }
}

module.exports = {
    recordOmikujiDraw,
    countRecentDaikyo,
};

