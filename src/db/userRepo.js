// src/db/userRepo.js
const { openDb } = require('./sqlite');

function getNow() {
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

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// なければ作る、あれば last_seen 更新
async function upsertUser({ dbPath, userId, guildId }) {
    const db = openDb(dbPath);
    const now = getNow();

    // INSERT OR IGNORE → UPDATE の2段で安全に
    await run(
        db,
        `
    INSERT OR IGNORE INTO users (user_id, guild_id, created_at, last_seen_at, nickname_mode)
    VALUES (?, ?, ?, ?, 1)
    `,
        [userId, guildId, now, now]
    );

    await run(
        db,
        `
    UPDATE users
    SET last_seen_at = ?
    WHERE user_id = ? AND guild_id = ?
    `,
        [now, userId, guildId]
    );

    const row = await get(
        db,
        `SELECT nickname_mode FROM users WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId]
    );

    db.close();

    return {
        nicknameMode: row ? row.nickname_mode === 1 : true,
    };
}

async function setNicknameMode({ dbPath, userId, guildId, nicknameMode }) {
    const db = openDb(dbPath);
    const now = getNow();

    await run(
        db,
        `
    INSERT OR IGNORE INTO users (user_id, guild_id, created_at, last_seen_at, nickname_mode)
    VALUES (?, ?, ?, ?, ?)
    `,
        [userId, guildId, now, now, nicknameMode ? 1 : 0]
    );

    await run(
        db,
        `
    UPDATE users
    SET nickname_mode = ?, last_seen_at = ?
    WHERE user_id = ? AND guild_id = ?
    `,
        [nicknameMode ? 1 : 0, now, userId, guildId]
    );

    db.close();
}

module.exports = { upsertUser, setNicknameMode };
