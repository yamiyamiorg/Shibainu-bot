// src/db/turnRepo.js
const { openDb } = require('./sqlite');

function nowSec() {
    return Math.floor(Date.now() / 1000);
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function clamp(text, max = 160) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : t.slice(0, max) + '…';
}

async function addTurn({ dbPath, userId, guildId, role, content }) {
    const db = openDb(dbPath);
    const ts = nowSec();

    await run(
        db,
        `
    INSERT INTO conversation_turns (user_id, guild_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
    `,
        [userId, guildId, role, clamp(content), ts]
    );

    // 直前4ターンだけ残す
    await run(
        db,
        `
    DELETE FROM conversation_turns
    WHERE id NOT IN (
      SELECT id FROM conversation_turns
      WHERE user_id = ? AND guild_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 4
    )
    AND user_id = ? AND guild_id = ?
    `,
        [userId, guildId, userId, guildId]
    );

    db.close();
}

async function getRecentTurns({ dbPath, userId, guildId }) {
    const db = openDb(dbPath);

    const rows = await all(
        db,
        `
    SELECT role, content
    FROM conversation_turns
    WHERE user_id = ? AND guild_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 4
    `,
        [userId, guildId]
    );

    db.close();
    return rows.reverse(); // 古い → 新しい
}

module.exports = { addTurn, getRecentTurns };
