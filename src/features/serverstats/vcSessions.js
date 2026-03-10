// src/features/serverstats/vcSessions.js
/**
 * VCセッション管理
 *
 * analytics/db.js から移植・統合。
 * 変更点:
 *   - vc_room_count（異なる部屋への参加数）を追加
 *   - DBコネクションをserverstats/db.jsのシングルトンに統一
 *   - 再起動跨ぎチェックポイントを維持
 */

const db = require('./db');
const { logger } = require('../../services/logger');

// インメモリセッション管理
// key: "userId:guildId"
const vcSessions = new Map();

// ─────────────────────────────────────────────
// セッション開始
// ─────────────────────────────────────────────

function startVcSession(userId, guildId, channelId = null) {
    const key = `${userId}:${guildId}`;
    vcSessions.set(key, {
        joinedAt:          Date.now(),
        lastMuteChange:    Date.now(),
        speakTime:         0,        // ミュートなし累積時間（ms）
        isMuted:           false,
        isSelfDeafened:    false,
        channelId:         channelId,
        visitedChannels:   channelId ? new Set([channelId]) : new Set(),
    });
}

// ─────────────────────────────────────────────
// セッション終了 → DB記録
// ─────────────────────────────────────────────

async function endVcSession(userId, guildId) {
    const key = `${userId}:${guildId}`;
    const session = vcSessions.get(key);
    if (!session) return;

    const now = Date.now();
    if (!session.isMuted && !session.isSelfDeafened) {
        session.speakTime += now - session.lastMuteChange;
    }

    const speakMinutes = session.speakTime / 60000;
    const roomCount    = session.visitedChannels.size;
    vcSessions.delete(key);

    if (speakMinutes < 1) return; // 1分未満は記録しない

    await db.recordVcSession(guildId, userId, speakMinutes, roomCount);
}

// ─────────────────────────────────────────────
// ミュート状態変化の追跡
// ─────────────────────────────────────────────

function updateVcMuteState(userId, guildId, isMuted, isSelfDeafened) {
    const key = `${userId}:${guildId}`;
    const session = vcSessions.get(key);
    if (!session) return;

    const now = Date.now();
    const wasActive   = !session.isMuted && !session.isSelfDeafened;
    const isNowActive = !isMuted && !isSelfDeafened;

    if (wasActive && !isNowActive) {
        session.speakTime += now - session.lastMuteChange;
    }

    session.lastMuteChange = now;
    session.isMuted        = isMuted;
    session.isSelfDeafened = isSelfDeafened;
}

// ─────────────────────────────────────────────
// チャンネル移動（異なる部屋カウント用）
// ─────────────────────────────────────────────

function updateVcChannel(userId, guildId, newChannelId) {
    const key = `${userId}:${guildId}`;
    const session = vcSessions.get(key);
    if (!session || !newChannelId) return;
    session.channelId = newChannelId;
    session.visitedChannels.add(newChannelId);
}

// ─────────────────────────────────────────────
// アクティブセッション一覧
// ─────────────────────────────────────────────

function getActiveVcSessions(guildId) {
    const result = [];
    for (const [key, session] of vcSessions.entries()) {
        const [uid, gid] = key.split(':');
        if (gid === guildId) result.push({ userId: uid, session });
    }
    return result;
}

function hasActiveSession(userId, guildId) {
    return vcSessions.has(`${userId}:${guildId}`);
}

// ─────────────────────────────────────────────
// 再起動跨ぎ: チェックポイント保存
// ─────────────────────────────────────────────

async function saveVcCheckpoints(guildId) {
    const now = Date.now();
    for (const [key, session] of vcSessions.entries()) {
        const [uid, gid] = key.split(':');
        if (guildId && gid !== guildId) continue;

        let speakTime = session.speakTime;
        if (!session.isMuted && !session.isSelfDeafened) {
            speakTime += now - session.lastMuteChange;
        }

        await db.saveVcCheckpoint(uid, gid, {
            joinedAt:        session.joinedAt,
            speakTime,
            isMuted:         session.isMuted,
            isSelfDeafened:  session.isSelfDeafened,
            lastMuteChange:  session.lastMuteChange,
            savedAt:         now,
        });
    }
}

// ─────────────────────────────────────────────
// 再起動跨ぎ: チェックポイント復元
// ─────────────────────────────────────────────

async function restoreVcCheckpoints(guildId) {
    const rows = await db.loadVcCheckpoints(guildId);
    const now  = Date.now();
    let count  = 0;

    for (const row of rows) {
        const key = `${row.user_id}:${row.guild_id}`;
        if (vcSessions.has(key)) continue; // Discord APIスキャン分は上書きしない

        vcSessions.set(key, {
            joinedAt:         row.joined_at,
            lastMuteChange:   now,
            speakTime:        row.speak_time,
            isMuted:          row.is_muted === 1,
            isSelfDeafened:   row.is_deafened === 1,
            channelId:        null,
            visitedChannels:  new Set(),
        });
        count++;
    }
    return count;
}

async function clearVcCheckpoints(guildId) {
    await db.clearVcCheckpoints(guildId);
}

module.exports = {
    startVcSession,
    endVcSession,
    updateVcMuteState,
    updateVcChannel,
    getActiveVcSessions,
    hasActiveSession,
    saveVcCheckpoints,
    restoreVcCheckpoints,
    clearVcCheckpoints,
};
