// src/features/serverstats/db.js

const path = require('path');
const { openDb } = require('../../db/sqlite');
const { logger } = require('../../services/logger');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'yamichan.db');

function resolveServerStatsDbPath() {
    const raw = process.env.ANALYTICS_DB_PATH || process.env.YAMICHAN_DB_PATH;
    if (!raw) return DEFAULT_DB_PATH;
    return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

const DB_PATH = resolveServerStatsDbPath();

let _db = null;
function getDb() {
    if (!_db) _db = openDb(DB_PATH);
    return _db;
}
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, function (err) {
            if (err) reject(err); else resolve(this);
        });
    });
}
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
}
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });
}

// ─────────────────────────────────────────────
// stats_message_ids（再起動跨ぎのメッセージID永続化）
// ─────────────────────────────────────────────

async function saveStatsMessageId(guildId, channelId, messageId) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO stats_message_ids (guild_id, channel_id, message_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = excluded.channel_id,
           message_id = excluded.message_id,
           updated_at = excluded.updated_at`,
        [guildId, channelId, messageId, now]
    );
}

async function getStatsMessageId(guildId) {
    return get(
        `SELECT channel_id, message_id FROM stats_message_ids WHERE guild_id = ?`,
        [guildId]
    );
}

// ─────────────────────────────────────────────
// server_stats_log
// ─────────────────────────────────────────────

async function saveStatsSnapshot(guildId, stats) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO server_stats_log
         (guild_id, recorded_at, all_members, members, bots, online,
          vc_total, vc_talking, vc_listening, vc_watching)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            guildId, now,
            stats.allMembers, stats.members, stats.bots, stats.onlineMembers,
            stats.vcTotal, stats.vcTalking, stats.vcListening, stats.vcWatching,
        ]
    );
}

async function getRecentSnapshots(guildId, hoursBack = 25) {
    const since = Math.floor(Date.now() / 1000) - hoursBack * 3600;
    return all(
        `SELECT * FROM server_stats_log
         WHERE guild_id = ? AND recorded_at >= ?
         ORDER BY recorded_at ASC`,
        [guildId, since]
    );
}

async function getSnapshotNearHoursAgo(guildId, hoursAgo = 24) {
    const target = Math.floor(Date.now() / 1000) - hoursAgo * 3600;
    const margin = 90 * 60;
    return get(
        `SELECT * FROM server_stats_log
         WHERE guild_id = ? AND recorded_at BETWEEN ? AND ?
         ORDER BY ABS(recorded_at - ?) ASC
         LIMIT 1`,
        [guildId, target - margin, target + margin, target]
    );
}

async function getPeakVcInRange(guildId, fromUnix, toUnix) {
    return get(
        `SELECT vc_total, recorded_at
         FROM server_stats_log
         WHERE guild_id = ? AND recorded_at BETWEEN ? AND ?
         ORDER BY vc_total DESC, recorded_at DESC
         LIMIT 1`,
        [guildId, fromUnix, toUnix]
    );
}

async function getTopVcMoments(guildId, fromUnix, toUnix, limit = 3) {
    return all(
        `SELECT vc_total, recorded_at
         FROM server_stats_log
         WHERE guild_id = ? AND recorded_at BETWEEN ? AND ?
         ORDER BY vc_total DESC, recorded_at DESC
         LIMIT ?`,
        [guildId, fromUnix, toUnix, limit]
    );
}

async function getHourlyVcAverage(guildId, daysBack = 30) {
    const since = Math.floor(Date.now() / 1000) - daysBack * 86400;
    return all(
        `SELECT
           CAST(strftime('%w', recorded_at + 32400, 'unixepoch') AS INTEGER) AS dow,
           CAST(strftime('%H', recorded_at + 32400, 'unixepoch') AS INTEGER) AS hour,
           AVG(vc_total) AS avg_vc,
           MAX(vc_total) AS max_vc,
           COUNT(*) AS sample_count
         FROM server_stats_log
         WHERE guild_id = ? AND recorded_at >= ?
         GROUP BY dow, hour
         ORDER BY dow, hour`,
        [guildId, since]
    );
}

async function getHourlyVcAverageRange(guildId, fromUnix, toUnix) {
    return all(
        `SELECT
           CAST(strftime('%w', recorded_at + 32400, 'unixepoch') AS INTEGER) AS dow,
           CAST(strftime('%H', recorded_at + 32400, 'unixepoch') AS INTEGER) AS hour,
           AVG(vc_total) AS avg_vc,
           MAX(vc_total) AS max_vc,
           COUNT(*) AS sample_count
         FROM server_stats_log
         WHERE guild_id = ? AND recorded_at BETWEEN ? AND ?
         GROUP BY dow, hour
         ORDER BY dow, hour`,
        [guildId, fromUnix, toUnix]
    );
}

/**
 * 活気ピーク保護付きパージ
 *
 * 削除方針:
 *   - 通常ログ: keepDays 日より古いものを削除
 *   - ただし「ピークスナップショット」は長期保存する:
 *     * VC参加人数が過去最大の上位 peakKeepCount 件
 *     * オンライン人数が過去最大の上位 peakKeepCount 件
 *   → 活気があった時期の記録が消えない
 */
async function purgeOldSnapshots(guildId, keepDays = 90, peakKeepCount = 20) {
    const cutoff = Math.floor(Date.now() / 1000) - keepDays * 86400;

    // ピーク保護: VC人数・オンライン人数上位のIDを取得
    const peakRows = await all(
        `SELECT id FROM server_stats_log
         WHERE guild_id = ?
         ORDER BY vc_total DESC, online DESC
         LIMIT ?`,
        [guildId, peakKeepCount]
    );
    const protectedIds = peakRows.map(r => r.id);

    let deletedCount = 0;
    if (protectedIds.length > 0) {
        const placeholders = protectedIds.map(() => '?').join(',');
        const result = await run(
            `DELETE FROM server_stats_log
             WHERE guild_id = ? AND recorded_at < ?
             AND id NOT IN (${placeholders})`,
            [guildId, cutoff, ...protectedIds]
        );
        deletedCount = result.changes;
    } else {
        const result = await run(
            `DELETE FROM server_stats_log WHERE guild_id = ? AND recorded_at < ?`,
            [guildId, cutoff]
        );
        deletedCount = result.changes;
    }

    if (deletedCount > 0) {
        logger.info('serverstats.purge.done', {
            guildId, deleted: deletedCount, protected: protectedIds.length
        });
    }
    return deletedCount;
}

/**
 * 全期間のピーク統計を取得（Embed表示用）
 */
async function getAllTimePeaks(guildId) {
    return get(
        `SELECT
           MAX(vc_total)   AS peak_vc,
           MAX(online)     AS peak_online,
           MAX(all_members) AS peak_members,
           (SELECT recorded_at FROM server_stats_log WHERE guild_id = ? ORDER BY vc_total DESC LIMIT 1) AS peak_vc_at,
           (SELECT recorded_at FROM server_stats_log WHERE guild_id = ? ORDER BY online DESC LIMIT 1) AS peak_online_at
         FROM server_stats_log WHERE guild_id = ?`,
        [guildId, guildId, guildId]
    );
}

// ─────────────────────────────────────────────
// member_join_log
// ─────────────────────────────────────────────

async function recordMemberJoin(guildId, userId) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT OR IGNORE INTO member_join_log (guild_id, user_id, joined_at) VALUES (?, ?, ?)`,
        [guildId, userId, now]
    );
}

async function getRecentJoinCount(guildId, hoursBack = 24) {
    const since = Math.floor(Date.now() / 1000) - hoursBack * 3600;
    const row = await get(
        `SELECT COUNT(*) AS cnt FROM member_join_log WHERE guild_id = ? AND joined_at >= ?`,
        [guildId, since]
    );
    return row?.cnt ?? 0;
}

async function getLastJoinTime(guildId) {
    const row = await get(
        `SELECT joined_at FROM member_join_log WHERE guild_id = ? ORDER BY joined_at DESC LIMIT 1`,
        [guildId]
    );
    return row?.joined_at ?? null;
}

async function purgeOldJoinLog(guildId, keepDays = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - keepDays * 86400;
    const result = await run(
        `DELETE FROM member_join_log WHERE guild_id = ? AND joined_at < ?`,
        [guildId, cutoff]
    );
    return result.changes;
}

// ─────────────────────────────────────────────
// keyword_log
// ─────────────────────────────────────────────

async function saveKeywordSnapshot(guildId, words) {
    if (!words || words.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    for (const { word, count } of words) {
        await run(
            `INSERT INTO keyword_log (guild_id, recorded_at, word, count) VALUES (?, ?, ?, ?)`,
            [guildId, now, word, count]
        );
    }
}

async function getRecentKeywords(guildId, hoursBack = 1, topN = 5) {
    const since = Math.floor(Date.now() / 1000) - hoursBack * 3600;
    return all(
        `SELECT word, SUM(count) AS total
         FROM keyword_log
         WHERE guild_id = ? AND recorded_at >= ?
         GROUP BY word
         ORDER BY total DESC
         LIMIT ?`,
        [guildId, since, topN]
    );
}

async function purgeOldKeywordLog(guildId, keepDays = 7) {
    const cutoff = Math.floor(Date.now() / 1000) - keepDays * 86400;
    const result = await run(
        `DELETE FROM keyword_log WHERE guild_id = ? AND recorded_at < ?`,
        [guildId, cutoff]
    );
    return result.changes;
}

// ─────────────────────────────────────────────
// VC セッション永続化（analytics廃止後はここで管理）
// ─────────────────────────────────────────────

async function saveVcCheckpoint(userId, guildId, session) {
    await run(
        `INSERT INTO vc_session_checkpoints
           (user_id, guild_id, joined_at, speak_time, is_muted, is_deafened, last_mute_change, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, guild_id) DO UPDATE SET
           joined_at        = excluded.joined_at,
           speak_time       = excluded.speak_time,
           is_muted         = excluded.is_muted,
           is_deafened      = excluded.is_deafened,
           last_mute_change = excluded.last_mute_change,
           saved_at         = excluded.saved_at`,
        [userId, guildId, session.joinedAt, session.speakTime,
            session.isMuted ? 1 : 0, session.isSelfDeafened ? 1 : 0,
            session.lastMuteChange, session.savedAt]
    );
}

async function loadVcCheckpoints(guildId) {
    return all(
        `SELECT * FROM vc_session_checkpoints WHERE guild_id = ?`,
        [guildId]
    );
}

async function clearVcCheckpoints(guildId) {
    await run(
        `DELETE FROM vc_session_checkpoints WHERE guild_id = ?`,
        [guildId]
    );
}

// ─────────────────────────────────────────────
// VC 日次集計（常連スコア・週次レポート用）
// ─────────────────────────────────────────────

function getTodayString() {
    const d = new Date(Date.now() + 9 * 3600 * 1000); // JST
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * VCセッション終了時に発話時間・部屋数を日次集計にupsert
 * @param {string} guildId
 * @param {string} userId
 * @param {number} speakMinutes  ミュートなし発話時間（分）
 * @param {number} roomCount     このセッションで訪問した部屋の数
 */
async function recordVcSession(guildId, userId, speakMinutes, roomCount = 1) {
    if (speakMinutes <= 0) return;
    const date = getTodayString();
    await run(
        `INSERT INTO user_activity_daily
           (date, user_id, guild_id, vc_total_minutes, vc_active_minutes, vc_join_count, vc_room_count)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(date, user_id, guild_id) DO UPDATE SET
           vc_total_minutes  = vc_total_minutes  + excluded.vc_total_minutes,
           vc_active_minutes = vc_active_minutes + excluded.vc_active_minutes,
           vc_join_count     = vc_join_count + 1,
           vc_room_count     = vc_room_count + excluded.vc_room_count`,
        [date, userId, guildId, speakMinutes, speakMinutes, roomCount]
    );
}

/**
 * 直近N日間のVC集計を取得（常連スコア計算用）
 * @param {string} guildId
 * @param {number} days
 */
async function getVcActivityRange(guildId, days = 14) {
    const dates = [];
    const base = new Date(Date.now() + 9 * 3600 * 1000);
    for (let i = 0; i < days; i++) {
        const d = new Date(base.getTime() - i * 86400000);
        dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
    }
    const placeholders = dates.map(() => '?').join(',');
    return all(
        `SELECT
           user_id,
           COUNT(DISTINCT date)          AS vc_days,
           SUM(vc_total_minutes)         AS total_vc_minutes,
           SUM(vc_active_minutes)        AS total_active_minutes,
           SUM(vc_join_count)            AS total_vc_joins,
           SUM(vc_room_count)            AS room_count
         FROM user_activity_daily
         WHERE guild_id = ? AND date IN (${placeholders})
           AND vc_total_minutes > 0
         GROUP BY user_id`,
        [guildId, ...dates]
    );
}

/**
 * 週次レポート用: 指定期間のVC集計TOP N
 */
async function getWeeklyVcTop(guildId, fromDate, toDate, limit = 5) {
    return all(
        `SELECT user_id, SUM(vc_active_minutes) AS total_minutes
         FROM user_activity_daily
         WHERE guild_id = ? AND date BETWEEN ? AND ?
           AND vc_active_minutes > 0
         GROUP BY user_id
         ORDER BY total_minutes DESC
         LIMIT ?`,
        [guildId, fromDate, toDate, limit]
    );
}

// ─────────────────────────────────────────────
// 絵文字使用統計（週次レポート用）
// ─────────────────────────────────────────────

async function recordEmoji(guildId, emoji, count = 1) {
    const date = getTodayString();
    await run(
        `INSERT INTO emoji_usage (date, guild_id, emoji, count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(date, guild_id, emoji) DO UPDATE SET
           count = count + excluded.count`,
        [date, guildId, emoji, count]
    );
}

async function getTopEmojisRange(guildId, fromDate, toDate, limit = 5) {
    return all(
        `SELECT emoji, SUM(count) AS total
         FROM emoji_usage
         WHERE guild_id = ? AND date BETWEEN ? AND ?
         GROUP BY emoji
         ORDER BY total DESC
         LIMIT ?`,
        [guildId, fromDate, toDate, limit]
    );
}

async function purgeOldEmojiLog(guildId, keepDays = 30) {
    const cutoff = getTodayString(); // 簡易: 後でdate演算
    // keepDays日より古い日付を計算
    const d = new Date(Date.now() + 9 * 3600 * 1000 - keepDays * 86400000);
    const cutoffDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const result = await run(
        `DELETE FROM emoji_usage WHERE guild_id = ? AND date < ?`,
        [guildId, cutoffDate]
    );
    return result.changes;
}

// ─────────────────────────────────────────────
// VC 呼び水通知クールダウン
// ─────────────────────────────────────────────

async function getVcNotifyCooldown(guildId) {
    return get(
        `SELECT notified_at FROM vc_notify_cooldowns WHERE guild_id = ?`,
        [guildId]
    );
}

async function setVcNotifyCooldown(guildId) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO vc_notify_cooldowns (guild_id, notified_at) VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET notified_at = excluded.notified_at`,
        [guildId, now]
    );
}

async function getVcNotifyMessageId(guildId) {
    return get(
        `SELECT channel_id, message_id FROM vc_notify_message_ids WHERE guild_id = ?`,
        [guildId]
    );
}

async function saveVcNotifyMessageId(guildId, channelId, messageId) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO vc_notify_message_ids (guild_id, channel_id, message_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = excluded.channel_id,
           message_id = excluded.message_id,
           updated_at = excluded.updated_at`,
        [guildId, channelId, messageId, now]
    );
}

// ─────────────────────────────────────────────
// VC 入室ログ（タイムスタンプ・出入り回数表示用）
// ─────────────────────────────────────────────

async function recordVcEntry(guildId, channelId, userId) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO vc_entry_log (guild_id, channel_id, user_id, entered_at)
         VALUES (?, ?, ?, ?)`,
        [guildId, channelId, userId, now]
    );
}

/**
 * 指定チャンネルの直近N分以内の最後の入室時刻を返す
 */
async function getLastVcEntry(guildId, channelId) {
    const row = await get(
        `SELECT entered_at FROM vc_entry_log
         WHERE guild_id = ? AND channel_id = ?
         ORDER BY entered_at DESC LIMIT 1`,
        [guildId, channelId]
    );
    return row?.entered_at ?? null;
}

/**
 * 今日の指定チャンネルへの入室回数
 */
async function getTodayVcEntryCount(guildId, channelId) {
    const todayStart = Math.floor(new Date(getTodayString() + 'T00:00:00+09:00').getTime() / 1000);
    const row = await get(
        `SELECT COUNT(*) AS cnt FROM vc_entry_log
         WHERE guild_id = ? AND channel_id = ? AND entered_at >= ?`,
        [guildId, channelId, todayStart]
    );
    return row?.cnt ?? 0;
}

async function purgeOldVcEntryLog(guildId, keepDays = 3) {
    const cutoff = Math.floor(Date.now() / 1000) - keepDays * 86400;
    const result = await run(
        `DELETE FROM vc_entry_log WHERE guild_id = ? AND entered_at < ?`,
        [guildId, cutoff]
    );
    return result.changes;
}

// ─────────────────────────────────────────────
// 今日の一言メッセージID
// ─────────────────────────────────────────────

async function getDailyWordMessageId(guildId) {
    return get(
        `SELECT channel_id, message_id, posted_date
         FROM daily_word_message_ids WHERE guild_id = ?`,
        [guildId]
    );
}

async function saveDailyWordMessageId(guildId, channelId, messageId, postedDate) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO daily_word_message_ids
           (guild_id, channel_id, message_id, posted_date, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id  = excluded.channel_id,
           message_id  = excluded.message_id,
           posted_date = excluded.posted_date,
           updated_at  = excluded.updated_at`,
        [guildId, channelId, messageId, postedDate, now]
    );
}

// ─────────────────────────────────────────────
// 発言日次集計（週次レポートのactive_users用）
// ─────────────────────────────────────────────

async function recordDailyMessage(guildId, userId) {
    const date = getTodayString();
    await run(
        `INSERT INTO user_activity_daily (date, user_id, guild_id, message_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(date, user_id, guild_id) DO UPDATE SET
           message_count = message_count + 1`,
        [date, userId, guildId]
    );
}

// ─────────────────────────────────────────────
// 週次レポート用: 発言ユーザー数・メッセージ数
// ─────────────────────────────────────────────

async function getWeeklyMessageStats(guildId, fromDate, toDate) {
    return get(
        `SELECT
           COUNT(DISTINCT user_id) AS active_users,
           SUM(message_count)      AS total_messages
         FROM user_activity_daily
         WHERE guild_id = ? AND date BETWEEN ? AND ?`,
        [guildId, fromDate, toDate]
    );
}

async function getAverageWeeklyMessageStats(guildId, fromDate, toDate) {
    return get(
        `WITH weekly AS (
           SELECT
             strftime('%Y-%W', date) AS week_key,
             COUNT(DISTINCT user_id) AS active_users,
             SUM(message_count) AS total_messages
           FROM user_activity_daily
           WHERE guild_id = ? AND date BETWEEN ? AND ?
           GROUP BY week_key
         )
         SELECT
           AVG(active_users) AS avg_active_users,
           AVG(total_messages) AS avg_total_messages,
           COUNT(*) AS weeks_with_data
         FROM weekly`,
        [guildId, fromDate, toDate]
    );
}

async function getAverageWeeklyJoinCount(guildId, fromUnix, toUnix) {
    return get(
        `WITH weekly AS (
           SELECT
             strftime('%Y-%W', joined_at + 32400, 'unixepoch') AS week_key,
             COUNT(*) AS join_count
           FROM member_join_log
           WHERE guild_id = ? AND joined_at BETWEEN ? AND ?
           GROUP BY week_key
         )
         SELECT
           AVG(join_count) AS avg_joins,
           COUNT(*) AS weeks_with_data
         FROM weekly`,
        [guildId, fromUnix, toUnix]
    );
}


// ─────────────────────────────────────────────
// 週次レポートメッセージID
// ─────────────────────────────────────────────

async function getWeeklyReportMessageId(guildId) {
    return get(
        `SELECT channel_id, message_id FROM weekly_report_message_ids WHERE guild_id = ?`,
        [guildId]
    );
}

async function saveWeeklyReportMessageId(guildId, channelId, messageId) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO weekly_report_message_ids (guild_id, channel_id, message_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = excluded.channel_id,
           message_id = excluded.message_id,
           updated_at = excluded.updated_at`,
        [guildId, channelId, messageId, now]
    );
}

async function getCumulativeReportMessageId(guildId) {
    return get(
        `SELECT channel_id, message_id FROM cumulative_report_message_ids WHERE guild_id = ?`,
        [guildId]
    );
}

async function saveCumulativeReportMessageId(guildId, channelId, messageId) {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO cumulative_report_message_ids (guild_id, channel_id, message_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = excluded.channel_id,
           message_id = excluded.message_id,
           updated_at = excluded.updated_at`,
        [guildId, channelId, messageId, now]
    );
}

// DBのメッセージIDをクリア（メッセージが削除された時の回復用）
async function clearStatsMessageId(guildId) {
    await run(`DELETE FROM stats_message_ids WHERE guild_id = ?`, [guildId]);
}

async function clearWeeklyReportMessageId(guildId) {
    await run(`DELETE FROM weekly_report_message_ids WHERE guild_id = ?`, [guildId]);
}

async function clearCumulativeReportMessageId(guildId) {
    await run(`DELETE FROM cumulative_report_message_ids WHERE guild_id = ?`, [guildId]);
}

async function clearDailyWordMessageId(guildId) {
    await run(`DELETE FROM daily_word_message_ids WHERE guild_id = ?`, [guildId]);
}

// ─────────────────────────────────────────────
// VC 除外チャンネル管理（改善③: DB管理 + コマンド対応）
// ─────────────────────────────────────────────

/**
 * 除外チャンネルを追加 or 上書き
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} label  表示用ラベル（チャンネル名など）
 * @param {string} reason 除外理由（例: "内部専用" "作業部屋" "招待制"）
 */
async function addVcExcludedChannel(guildId, channelId, label = '', reason = '') {
    const now = Math.floor(Date.now() / 1000);
    await run(
        `INSERT INTO vc_excluded_channels (guild_id, channel_id, label, reason, added_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, channel_id) DO UPDATE SET
           label    = excluded.label,
           reason   = excluded.reason,
           added_at = excluded.added_at`,
        [guildId, channelId, label, reason, now]
    );
}

/**
 * 除外チャンネルを削除
 */
async function removeVcExcludedChannel(guildId, channelId) {
    await run(
        `DELETE FROM vc_excluded_channels WHERE guild_id = ? AND channel_id = ?`,
        [guildId, channelId]
    );
}

/**
 * 除外チャンネル一覧を取得
 * @returns {Promise<Array<{channel_id, label, reason, added_at}>>}
 */
async function getVcExcludedChannels(guildId) {
    return all(
        `SELECT channel_id, label, reason, added_at
         FROM vc_excluded_channels WHERE guild_id = ?
         ORDER BY added_at DESC`,
        [guildId]
    );
}

// ─────────────────────────────────────────────
// VC 入室ログ — user_id付き取得（改善⑤: 直近入室ユーザー名）
// ─────────────────────────────────────────────

/**
 * 指定チャンネルの最新入室レコードをuser_idつきで返す。
 * @param {string} guildId
 * @param {string} channelId
 * @returns {Promise<{user_id: string, entered_at: number}|null>}
 */
async function getLastVcEntryWithUser(guildId, channelId) {
    return get(
        `SELECT user_id, entered_at FROM vc_entry_log
         WHERE guild_id = ? AND channel_id = ?
         ORDER BY entered_at DESC LIMIT 1`,
        [guildId, channelId]
    );
}

module.exports = {
    // message ID persistence
    saveStatsMessageId,
    getStatsMessageId,
    // snapshots
    saveStatsSnapshot,
    getRecentSnapshots,
    getSnapshotNearHoursAgo,
    getPeakVcInRange,
    getTopVcMoments,
    getHourlyVcAverage,
    getHourlyVcAverageRange,
    getAllTimePeaks,
    purgeOldSnapshots,
    // join log
    recordMemberJoin,
    getRecentJoinCount,
    getLastJoinTime,
    purgeOldJoinLog,
    // keywords
    saveKeywordSnapshot,
    getRecentKeywords,
    purgeOldKeywordLog,
    // VC session checkpoints
    saveVcCheckpoint,
    loadVcCheckpoints,
    clearVcCheckpoints,
    // VC daily activity
    recordVcSession,
    getVcActivityRange,
    getWeeklyVcTop,
    // emoji
    recordEmoji,
    getTopEmojisRange,
    purgeOldEmojiLog,
    // VC notify cooldown
    getVcNotifyCooldown,
    setVcNotifyCooldown,
    getVcNotifyMessageId,
    saveVcNotifyMessageId,
    // VC entry log
    recordVcEntry,
    getLastVcEntry,
    getTodayVcEntryCount,
    purgeOldVcEntryLog,
    // daily word
    getDailyWordMessageId,
    saveDailyWordMessageId,
    // weekly report
    recordDailyMessage,
    getWeeklyMessageStats,
    getAverageWeeklyMessageStats,
    getAverageWeeklyJoinCount,
    getWeeklyReportMessageId,
    saveWeeklyReportMessageId,
    getCumulativeReportMessageId,
    saveCumulativeReportMessageId,
    // ID clear（メッセージが削除された時の回復用）
    clearStatsMessageId,
    clearWeeklyReportMessageId,
    clearCumulativeReportMessageId,
    clearDailyWordMessageId,
    // VC 除外チャンネル管理（改善③）
    addVcExcludedChannel,
    removeVcExcludedChannel,
    getVcExcludedChannels,
    // VC 入室ログ拡張（改善⑤）
    getLastVcEntryWithUser,
};
