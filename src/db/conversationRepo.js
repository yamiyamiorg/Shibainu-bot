// src/db/conversationRepo.js
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

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function getConversationState({ dbPath, userId, guildId }) {
    const db = openDb(dbPath);
    const row = await get(
        db,
        `SELECT last_topic_hint FROM conversation_state WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId]
    );
    db.close();
    return row?.last_topic_hint ?? null;
}

async function setConversationHint({ dbPath, userId, guildId, hint }) {
    const db = openDb(dbPath);
    const ts = nowSec();

    await run(
        db,
        `
    INSERT OR REPLACE INTO conversation_state (user_id, guild_id, last_topic_hint, updated_at)
    VALUES (?, ?, ?, ?)
    `,
        [userId, guildId, hint, ts]
    );

    db.close();
}

async function clearConversationHint({ dbPath, userId, guildId }) {
    const db = openDb(dbPath);
    const ts = nowSec();

    await run(
        db,
        `
    UPDATE conversation_state
    SET last_topic_hint = NULL, updated_at = ?
    WHERE user_id = ? AND guild_id = ?
    `,
        [ts, userId, guildId]
    );

    db.close();
}

module.exports = { getConversationState, setConversationHint, clearConversationHint };
