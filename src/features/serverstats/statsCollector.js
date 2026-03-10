// src/features/serverstats/statsCollector.js
/**
 * サーバー統計データ収集ロジック
 *
 * index.jsから分離した純粋なデータ収集関数群。
 * Discord Clientのguildオブジェクトを受け取りデータを返す。
 * タイマーやDBへの書き込みは行わない（副作用なし）。
 */

'use strict';

const { ChannelType } = require('discord.js');
const path = require('path');
const { logger } = require('../../services/logger');
const { extractKeywords } = require('./keywordExtractor');
const { isExcludedRecommendRoom } = require('./vcNotifier');
const db = require('./db');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'yamichan.db');

function resolveDbPath() {
    const raw = process.env.ANALYTICS_DB_PATH || process.env.YAMICHAN_DB_PATH;
    if (!raw) return DEFAULT_DB_PATH;
    return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

/**
 * サーバー全体の統計数値を収集する
 * @param {Guild} guild
 * @returns {Promise<object|null>}
 */
async function collectServerStats(guild) {
    try {
        await guild.members.fetch();
        const allMembers = guild.memberCount || 0;
        const members = guild.members.cache.filter(m => !m.user.bot).size;
        const bots = guild.members.cache.filter(m => m.user.bot).size;
        const onlineMembers = guild.members.cache.filter(
            m => !m.user.bot && m.presence?.status && m.presence.status !== 'offline'
        ).size;
        const channels = guild.channels.cache.size;
        const roles = guild.roles.cache.size;
        const boostLevel = guild.premiumTier || 0;
        const boostCount = guild.premiumSubscriptionCount || 0;

        let vcTotal = 0, vcTalking = 0, vcListening = 0, vcWatching = 0;
        for (const [, ch] of guild.channels.cache) {
            if (ch.type !== ChannelType.GuildVoice) continue;
            if (isExcludedRecommendRoom({ id: ch.id, name: ch.name })) continue;
            for (const [, member] of ch.members) {
                if (member.user.bot) continue;
                vcTotal++;
                const v = member.voice;
                const isDeaf = !!(v.serverDeaf || v.selfDeaf);
                const isMuted = !!(v.serverMute || v.selfMute);
                if (isDeaf) vcWatching++;
                else if (isMuted) vcListening++;
                else vcTalking++;
            }
        }

        return {
            allMembers, members, bots, onlineMembers, channels, roles,
            boostLevel, boostCount, vcTotal, vcTalking, vcListening, vcWatching
        };
    } catch (err) {
        logger.error('serverstats.collect.error', { err: err?.message });
        return null;
    }
}

/**
 * VC部屋ごとの人数内訳を収集する
 * @param {Guild} guild
 * @returns {Array}
 */
function collectVcRooms(guild) {
    const rooms = [];
    for (const [, ch] of guild.channels.cache) {
        if (ch.type !== ChannelType.GuildVoice) continue;
        let talking = 0, listening = 0, watching = 0;
        let mutedCount = 0, deafenedCount = 0, streamingCount = 0;
        for (const [, member] of ch.members) {
            if (member.user.bot) continue;
            const v = member.voice;
            const isDeaf = !!(v.serverDeaf || v.selfDeaf);
            const isMuted = !!(v.serverMute || v.selfMute);
            const isStreaming = !!(v.streaming || v.selfVideo);

            if (isStreaming) streamingCount++;
            if (isDeaf) {
                deafenedCount++;
                watching++;
            } else if (isMuted) {
                mutedCount++;
                listening++;
            } else {
                talking++;
            }
        }
        rooms.push({
            id: ch.id, name: ch.name,
            total: talking + listening + watching,
            talking, listening, watching,
            mutedCount, deafenedCount, streamingCount,
            limit: ch.userLimit || 0,
        });
    }
    return rooms.sort((a, b) => b.total - a.total);
}

/**
 * テキストチャンネルの直近メッセージからキーワードを抽出してDBに保存する
 * @param {Guild} guild
 */
async function collectAndSaveKeywords(guild) {
    try {
        const targetIds = (process.env.SERVERSTATS_KEYWORD_CHANNELS || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        if (targetIds.length === 0) return;

        const sinceMs = Date.now() - 60 * 60 * 1000;
        const allTexts = [];

        for (const chId of targetIds) {
            const ch = guild.channels.cache.get(chId);
            if (!ch || ch.type !== ChannelType.GuildText) continue;
            try {
                const msgs = await ch.messages.fetch({ limit: 100 });
                for (const [, msg] of msgs) {
                    if (msg.createdTimestamp < sinceMs || msg.author.bot) continue;
                    allTexts.push(msg.content);
                }
            } catch (e) {
                logger.warn('serverstats.keyword.fetch_error', { chId, err: e?.message });
            }
        }

        if (allTexts.length === 0) return;
        const words = extractKeywords(allTexts.join('\n'));
        if (words.length > 0) await db.saveKeywordSnapshot(String(guild.id), words);
    } catch (err) {
        logger.error('serverstats.keyword.error', { err: err?.message });
    }
}

/**
 * 直近24時間の日記リアクション数を取得する（C-1表示用）
 * nukumori_reactionsテーブルが存在しない場合はnullを返す
 * @param {string} guildId
 * @returns {Promise<number|null>}
 */
async function getDiaryReactionCount(guildId) {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = resolveDbPath();

        return await new Promise((resolve) => {
            const tmpDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) { resolve(null); return; }
            });
            const since = Math.floor(Date.now() / 1000) - 86400;
            tmpDb.get(
                `SELECT COUNT(DISTINCT message_id) AS cnt FROM nukumori_reactions WHERE recorded_at >= ?`,
                [since],
                (err, row) => { tmpDb.close(); resolve(err ? null : (row?.cnt ?? null)); }
            );
        });
    } catch { return null; }
}

module.exports = {
    collectServerStats,
    collectVcRooms,
    collectAndSaveKeywords,
    getDiaryReactionCount,
};
