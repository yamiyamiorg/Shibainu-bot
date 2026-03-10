"use strict";
/**
 * imagegen/violations.js
 *
 * 違反累積管理・BAN・管理者通知。
 *
 * ■ DBテーブル: imagegen_violations
 *   - 1ユーザー違反1レコード（累積カウント）
 *   - BAN中かどうかを ban_until で管理
 *
 * ■ 累積BAN段階
 *   1回目: 記録のみ（警告メッセージ）
 *   2回目: 1時間BAN
 *   3回目以上: 24時間BAN + 管理者チャンネル通知
 */

const { logger } = require("../../services/logger");

// ─── DB操作ヘルパー ──────────────────────────────────────────────────────────

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
            else resolve(row ?? null);
        });
    });
}

// ─── マイグレーション ────────────────────────────────────────────────────────

/**
 * imagegen_violations テーブルを作成する（migrations.js から呼ばれる想定だが
 * 独立して呼んでも二重作成しない）。
 */
async function migrateViolations(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS imagegen_violations (
        user_id     TEXT NOT NULL,
        guild_id    TEXT NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        ban_until   INTEGER NOT NULL DEFAULT 0,
        last_reason TEXT,
        last_at     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, guild_id)
    );`);
}

// ─── BAN チェック ────────────────────────────────────────────────────────────

/**
 * ユーザーが現在BANされているか確認する。
 * @returns {Promise<{ banned: false } | { banned: true, remainingMs: number }>}
 */
async function checkBan(db, userId, guildId) {
    const row = await get(db,
        `SELECT ban_until FROM imagegen_violations WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId]
    );
    if (!row) return { banned: false };

    const now = Date.now();
    if (row.ban_until > now) {
        return { banned: true, remainingMs: row.ban_until - now };
    }
    return { banned: false };
}

// ─── 違反記録 ────────────────────────────────────────────────────────────────

const BAN_DURATIONS = {
    1: 0,                    // 1回目: BANなし（警告のみ）
    2: 60 * 60 * 1000,       // 2回目: 1時間
    3: 24 * 60 * 60 * 1000   // 3回目以上: 24時間
};

/**
 * 違反を記録し、BAN処理を行う。
 * @returns {Promise<{ count: number, banUntil: number, isNew: boolean }>}
 */
async function recordViolation(db, userId, guildId, reason) {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);

    // UPSERT
    await run(db, `
        INSERT INTO imagegen_violations (user_id, guild_id, count, ban_until, last_reason, last_at)
        VALUES (?, ?, 1, 0, ?, ?)
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
            count       = count + 1,
            last_reason = excluded.last_reason,
            last_at     = excluded.last_at
    `, [userId, guildId, reason, nowSec]);

    const row = await get(db,
        `SELECT count, ban_until FROM imagegen_violations WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId]
    );

    const count = row.count;
    const banDurationMs = BAN_DURATIONS[count] ?? BAN_DURATIONS[3];
    const banUntil = banDurationMs > 0 ? now + banDurationMs : 0;

    if (banUntil > 0) {
        await run(db,
            `UPDATE imagegen_violations SET ban_until = ? WHERE user_id = ? AND guild_id = ?`,
            [banUntil, userId, guildId]
        );
    }

    logger.warn("imagegen.violation.recorded", {
        userId, guildId, count,
        banUntil: banUntil ? new Date(banUntil).toISOString() : "none",
        reason
    });

    return { count, banUntil, isNew: count === 1 };
}

// ─── 管理者通知 ──────────────────────────────────────────────────────────────

/**
 * 違反累積が閾値を超えた場合に管理者チャンネルへ通知する。
 * IMG_MOD_CHANNEL_ID が未設定の場合はスキップ。
 */
async function notifyModerator(client, { userId, guildId, count, reason, banUntil }) {
    const modChannelId = process.env.IMG_MOD_CHANNEL_ID;
    if (!modChannelId) return;

    // 2回目以上で通知
    if (count < 2) return;

    try {
        const channel = await client.channels.fetch(modChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        const banText = banUntil
            ? `🔴 <t:${Math.floor(banUntil / 1000)}:R> まで BAN`
            : "⚠️ 警告（BAN なし）";

        const msg = [
            `🚨 **ImageGen 違反通知**`,
            `ユーザー: <@${userId}> (\`${userId}\`)`,
            `サーバー: \`${guildId}\``,
            `違反回数: **${count}回目**`,
            `理由: ${reason}`,
            `処置: ${banText}`,
        ].join("\n");

        await channel.send({ content: msg });

        logger.info("imagegen.violation.mod_notified", { userId, guildId, count });
    } catch (err) {
        logger.warn("imagegen.violation.notify_failed", { err: err?.message });
    }
}

// ─── 管理者向け情報取得 ──────────────────────────────────────────────────────

/**
 * 指定ユーザーの違反情報を返す。
 */
async function getViolationInfo(db, userId, guildId) {
    return await get(db,
        `SELECT * FROM imagegen_violations WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId]
    );
}

/**
 * 指定ユーザーの違反情報を手動でリセット（管理者用）。
 */
async function resetViolation(db, userId, guildId) {
    await run(db,
        `DELETE FROM imagegen_violations WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId]
    );
    logger.info("imagegen.violation.reset", { userId, guildId });
}

/**
 * 指定ユーザーを手動でBANする（管理者用）。
 * @param {number} durationMs  BAN時間(ms)。0 なら解除。
 */
async function setBan(db, userId, guildId, durationMs) {
    const now = Date.now();
    const banUntil = durationMs > 0 ? now + durationMs : 0;

    await run(db, `
        INSERT INTO imagegen_violations (user_id, guild_id, count, ban_until, last_reason, last_at)
        VALUES (?, ?, 0, ?, 'manual', ?)
        ON CONFLICT(user_id, guild_id) DO UPDATE SET ban_until = excluded.ban_until
    `, [userId, guildId, banUntil, Math.floor(now / 1000)]);

    logger.info("imagegen.violation.manual_ban", {
        userId, guildId,
        banUntil: banUntil ? new Date(banUntil).toISOString() : "lifted"
    });

    return banUntil;
}

module.exports = {
    migrateViolations,
    checkBan,
    recordViolation,
    notifyModerator,
    getViolationInfo,
    resetViolation,
    setBan
};
