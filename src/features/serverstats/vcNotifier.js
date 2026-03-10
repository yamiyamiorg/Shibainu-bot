// src/features/serverstats/vcNotifier.js
/**
 * VC呼び水通知 & 今がチャンス通知
 *
 * 通知A（呼び水）: VC全体が賑わっていて、入りやすい部屋がある
 * 通知B（チャンス）: VCに人はいるが「入りやすい部屋」が空席で、部屋を立てるチャンス
 *
 * 「入りやすい部屋」の判定:
 *   - 人数制限なし（userLimit === 0）
 *   - かつ全員ミュート（watching === total）でない
 *   ※ 名前・チャンネルIDに依存しない、ユーザー状態ベースの判定
 *
 * クールダウン: サーバー全体で1時間（案A）
 * 常連さん: なじんだメンバーかつ非オフィサーが1人以上VCにいる場合、文言に追記
 *
 * [改善]
 *   1. vcTotalのカウントから除外チャンネルを除外（精度向上）
 *   2. おすすめ複数部屋表示（最大2部屋）
 *   3. 除外IDのDB管理 + スラッシュコマンド対応（getExcludedIds / addExcludedId / removeExcludedId）
 *   4. 時間帯に応じた文言切り替え（深夜・朝・昼・夕・夜）
 *   5. 直近入室ユーザー名を通知に添える
 */

const { EmbedBuilder } = require('discord.js');
const { logger }       = require('../../services/logger');
const db               = require('./db');
const { OFFICER_ROLE_ID, REGULAR_ROLE_ID } = require('./regularScore');

// 環境変数設定
const VC_NOTIFY_THRESHOLD = parseInt(process.env.VC_NOTIFY_THRESHOLD || '10', 10);
const VC_CHANCE_THRESHOLD = parseInt(process.env.VC_CHANCE_THRESHOLD || '8', 10);
const COOLDOWN_MS         = 60 * 60 * 1000; // 1時間

const VC_SLOT_TITLE = 'VCが賑わってるよ';

const EXCLUDED_RECOMMEND_VC_NAMES = (process.env.VC_RECOMMEND_EXCLUDE_NAMES || '初心者向け&みんなの居場所')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const EXCLUDED_KEYWORDS = (process.env.VC_RECOMMEND_EXCLUDE_KEYWORDS || '相談,身内,禁止,のみ')
    .split(',')
    .map((s) => normalizeRoomName(s))
    .filter(Boolean);
const SMALL_LIMIT_MAX = parseInt(process.env.VC_SMALL_LIMIT_MAX || '10', 10);

// VC推薦・賑わい表示から除外するチャンネルID（部室・会議室など内部向けルーム）
// ※ DB管理IDと合算して使用するため、起動時に一度 loadExcludedIds() を呼ぶこと
const HARDCODED_EXCLUDED_IDS = new Set([
    '1476734999662428211', // 企画部部室
    '1458765208481956096', // 広報部部室
    '1463025949330247680', // 制作部会議室
    '1452287057496903791', // ひみつの会議室
    '1474023330322583633', // お仕事中です
    '1464528705283166289', // PRリーダー会議室
    '1452478942588960900', // 案内部部室
    '1455762948881387691', // 開発部会議室
    '1474229636534636674', // もくもく作業部屋
    '1458763743977668662', // ここサポ会議室
    ...(process.env.VC_RECOMMEND_EXCLUDE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

// DB管理の除外IDキャッシュ（起動時・コマンド操作後にリロード）
let _dbExcludedIds = new Set();

/**
 * DB管理の除外IDをメモリにロードする。
 * 起動時と、add/remove コマンド操作後に呼ぶ。
 * @param {string} guildId
 */
async function loadExcludedIds(guildId) {
    try {
        const rows = await db.getVcExcludedChannels(guildId);
        _dbExcludedIds = new Set(rows.map((r) => String(r.channel_id)));
    } catch (err) {
        logger.warn('vcnotifier.exclude.load_failed', { guildId, err: err?.message });
    }
}

/**
 * 除外チャンネルIDを追加（DB + メモリキャッシュ更新）
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} label  管理用ラベル（チャンネル名など）
 * @param {string} reason 除外理由（例: "内部専用" "作業部屋" "招待制"）
 */
async function addExcludedId(guildId, channelId, label = '', reason = '') {
    await db.addVcExcludedChannel(guildId, channelId, label, reason);
    _dbExcludedIds.add(String(channelId));
}

/**
 * 除外チャンネルIDを削除（DB + メモリキャッシュ更新）
 * @param {string} guildId
 * @param {string} channelId
 */
async function removeExcludedId(guildId, channelId) {
    await db.removeVcExcludedChannel(guildId, channelId);
    _dbExcludedIds.delete(String(channelId));
}

/**
 * 除外チャンネル一覧を取得（一覧表示コマンド用）
 * @param {string} guildId
 * @returns {Promise<Array<{channel_id, label, reason, added_at}>>}
 */
async function listExcludedIds(guildId) {
    return db.getVcExcludedChannels(guildId);
}

// ─────────────────────────────────────────────
// 改善①: vcTotalの精度向上 — 除外チャンネルを除いた人数を計算
// ─────────────────────────────────────────────

/**
 * 除外チャンネルを除いた実質VC参加人数を計算する。
 * @param {Array} vcRooms  collectVcRooms() の返り値
 * @returns {number}
 */
function calcEffectiveVcTotal(vcRooms) {
    return vcRooms
        .filter((r) => !isExcludedRecommendRoom(r))
        .reduce((sum, r) => sum + r.total, 0);
}

// ─────────────────────────────────────────────
// 除外判定
// ─────────────────────────────────────────────

function normalizeRoomName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[\s　]/g, '')
        .replace(/＆/g, '&');
}

function isExcludedRecommendRoom(room) {
    const id = String(room?.id || '');
    if (id && (HARDCODED_EXCLUDED_IDS.has(id) || _dbExcludedIds.has(id))) return true;
    const roomName = normalizeRoomName(room?.name);
    if (EXCLUDED_RECOMMEND_VC_NAMES.some((n) => normalizeRoomName(n) === roomName)) return true;
    return EXCLUDED_KEYWORDS.some((k) => roomName.includes(k));
}

// ─────────────────────────────────────────────
// 改善④: 時間帯ラベル（JST基準）
// ─────────────────────────────────────────────

/**
 * 現在時刻(JST)に応じたフレーバーテキストを返す。
 * @returns {{ timeLabel: string, flavor: string }}
 */
function getTimeFlavor() {
    const jstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();

    if (jstHour >= 1 && jstHour < 5) {
        return {
            timeLabel: '深夜',
            flavor: 'まだ起きてる人いるよ 🌙　夜更かし仲間を探しに来て！',
        };
    }
    if (jstHour >= 5 && jstHour < 11) {
        return {
            timeLabel: '朝',
            flavor: 'おはようの挨拶がてら覗いてみて 🌅',
        };
    }
    if (jstHour >= 11 && jstHour < 14) {
        return {
            timeLabel: 'お昼',
            flavor: 'お昼どき、ちょっとお話ししない？ ☀️',
        };
    }
    if (jstHour >= 14 && jstHour < 18) {
        return {
            timeLabel: '昼下がり',
            flavor: '作業しながらでも、気軽に入ってみて 🎧',
        };
    }
    if (jstHour >= 18 && jstHour < 22) {
        return {
            timeLabel: '夕方〜夜',
            flavor: '仕事・学校終わりのメンバーが集まってきたよ 🌆',
        };
    }
    // 22〜翌1時
    return {
        timeLabel: '夜',
        flavor: 'まったり夜話しない？ 🌛',
    };
}

// ─────────────────────────────────────────────
// 改善⑤: 直近入室ユーザー名を取得
// ─────────────────────────────────────────────

/**
 * 指定チャンネルの直近入室ユーザーのdisplayNameを取得する。
 * vc_entry_log の最新レコードからuser_idを引き、Guildキャッシュで名前を解決する。
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} guildId
 * @param {string} channelId
 * @returns {Promise<string|null>} displayName or null
 */
async function getLastEntryUserName(guild, guildId, channelId) {
    try {
        const entry = await db.getLastVcEntryWithUser(guildId, channelId);
        if (!entry?.user_id) return null;

        // キャッシュから名前を解決
        const member = guild.members.cache.get(entry.user_id);
        if (!member) return null;
        return member.displayName || member.user.username || null;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────
// メッセージIDの管理
// ─────────────────────────────────────────────

async function findOldestVcSlotMessage(channel) {
    const botId = channel.client.user?.id;
    if (!botId) return null;

    let before = null;
    let oldest = null;

    while (true) {
        const options = before ? { limit: 100, before } : { limit: 100 };
        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        for (const [, msg] of messages) {
            if (msg.author?.id !== botId) continue;
            const title = msg?.embeds?.[0]?.title || '';
            if (!String(title).includes(VC_SLOT_TITLE)) continue;
            if (!oldest || msg.createdTimestamp < oldest.createdTimestamp) oldest = msg;
        }

        before = messages.last()?.id || null;
        if (!before || messages.size < 100) break;
    }

    return oldest;
}

async function editVcSlotMessage(channel, guildId, embed, eventName, opts = {}) {
    const payload = { embeds: [embed] };

    const saved = await db.getVcNotifyMessageId(guildId).catch(() => null);
    if (saved?.message_id) {
        try {
            const msg = await channel.messages.fetch(saved.message_id);
            await msg.edit(payload);
            return true;
        } catch (err) {
            logger.warn('vcnotifier.slot_edit_failed_saved', {
                guildId,
                channelId: channel.id,
                messageId: saved.message_id,
                event: eventName,
                err: err?.message,
            });
        }
    }

    const discovered = await findOldestVcSlotMessage(channel);
    if (discovered) {
        try {
            await discovered.edit(payload);
            await db.saveVcNotifyMessageId(guildId, channel.id, discovered.id).catch(() => { });
            return true;
        } catch (err) {
            logger.error('vcnotifier.slot_edit_error', {
                guildId,
                channelId: channel.id,
                messageId: discovered.id,
                event: eventName,
                err: err?.message,
            });
            return false;
        }
    }

    if (opts.allowCreate === false) {
        logger.warn('vcnotifier.slot_no_target_no_create', {
            guildId,
            channelId: channel.id,
            event: eventName,
        });
        return false;
    }

    try {
        const msg = await channel.send(payload);
        await db.saveVcNotifyMessageId(guildId, channel.id, msg.id).catch(() => { });
        logger.info('vcnotifier.slot_created', { guildId, channelId: channel.id, messageId: msg.id, event: eventName });
        return true;
    } catch (err) {
        logger.error('vcnotifier.slot_create_error', {
            guildId,
            channelId: channel.id,
            event: eventName,
            err: err?.message,
        });
        return false;
    }
}

// ─────────────────────────────────────────────
// 入りやすい部屋の判定（ユーザー状態ベース）
// ─────────────────────────────────────────────

/**
 * @param {{ total, talking, listening, watching, limit, mutedCount?, deafenedCount?, streamingCount?, name?, id? }} room
 * @returns {boolean}
 */
function isEntryFriendly(room) {
    if (room.total === 0) return false;
    if (isExcludedRecommendRoom(room)) return false;
    if (room.limit > 0 && room.total >= room.limit) return false;
    if (room.limit > 0 && room.limit <= SMALL_LIMIT_MAX) return false;

    const total = Math.max(1, room.total || 0);
    const deaf = Math.max(0, room.deafenedCount ?? room.watching ?? 0);
    const muted = Math.max(0, room.mutedCount ?? room.listening ?? 0);
    const streaming = Math.max(0, room.streamingCount ?? 0);

    const inactive = Math.min(total, deaf + muted);
    const inactiveRatio = inactive / total;
    if (inactiveRatio > 0.4) return false;

    let score = 100;
    if (room.limit > 0) score -= 15;
    score -= (deaf / total) * 45;
    score -= (muted / total) * 30;
    score -= (streaming / total) * 15;
    if (inactiveRatio <= 0.2 && room.limit === 0) score += 5;

    return score >= 60;
}

/**
 * 「入りやすい部屋がない」= 入りやすい部屋が0件
 */
function hasNoEntryFriendlyRoom(vcRooms) {
    return vcRooms.filter((r) => isEntryFriendly(r)).length === 0;
}

// ─────────────────────────────────────────────
// 常連さんがいるかチェック
// ─────────────────────────────────────────────

function countRegularsInVc(guild) {
    let count = 0;
    for (const [, member] of guild.members.cache) {
        if (!member.voice?.channelId) continue;
        if (member.user.bot) continue;
        if (member.roles.cache.has(OFFICER_ROLE_ID)) continue;
        if (member.roles.cache.has(REGULAR_ROLE_ID)) count++;
    }
    return count;
}

// ─────────────────────────────────────────────
// クールダウンチェック
// ─────────────────────────────────────────────

async function isOnCooldown(guildId) {
    const row = await db.getVcNotifyCooldown(guildId);
    if (!row) return false;
    return (Date.now() - row.notified_at * 1000) < COOLDOWN_MS;
}

async function setCooldown(guildId) {
    await db.setVcNotifyCooldown(guildId);
}

// ─────────────────────────────────────────────
// 通知A: 呼び水通知
// ─────────────────────────────────────────────

async function maybeSendVcBuzzNotify(channel, guild, vcRooms, vcTotal, opts = {}) {
    // 改善①: 除外チャンネルを除いた実質人数でしきい値判定
    const effectiveTotal = calcEffectiveVcTotal(vcRooms);
    if (effectiveTotal < VC_NOTIFY_THRESHOLD) return false;
    if (!opts.ignoreCooldown && await isOnCooldown(guild.id)) return false;

    // 改善②: 入りやすい部屋を最大2部屋まで表示
    const friendlyRooms = vcRooms.filter((r) => isEntryFriendly(r));
    if (friendlyRooms.length === 0) return false;

    const regularCount = countRegularsInVc(guild);
    const { flavor } = getTimeFlavor(); // 改善④

    const lines = [
        `🎤 今VCに **${effectiveTotal}人** がいるよ！`,
    ];

    // 改善②: 最大2部屋を紹介
    const displayRooms = friendlyRooms.slice(0, 2);
    for (const room of displayRooms) {
        // 改善⑤: 直近入室ユーザー名を取得
        const lastUser = await getLastEntryUserName(guild, guild.id, room.id);
        const suffix = lastUser ? `（さっき **${lastUser}** さんが入ったよ）` : `（${room.total}人）`;
        lines.push(`**${room.name}** が話しかけやすそう ${suffix}`);
    }

    if (regularCount > 0) {
        lines.push(`常連のメンバーも来てるみたい 🩷`);
    }

    // 改善④: 時間帯フレーバー
    lines.push(flavor);

    const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🎤 VCが賑わってるよ！')
        .setDescription(lines.join('\n'))
        .setTimestamp();

    try {
        const updated = await editVcSlotMessage(channel, guild.id, embed, 'buzz', opts);
        if (!updated) return false;

        if (!opts.ignoreCooldown) await setCooldown(guild.id);
        logger.info('vcnotifier.buzz.updated', { guildId: guild.id, effectiveTotal, rooms: displayRooms.map(r => r.name) });
        return true;
    } catch (err) {
        logger.error('vcnotifier.buzz.error', { guildId: guild.id, err: err?.message });
        return false;
    }
}

// ─────────────────────────────────────────────
// 通知B: 今がチャンス通知
// ─────────────────────────────────────────────

const chanceStartedAt = new Map();
const CHANCE_WAIT_MS  = 10 * 60 * 1000;

async function maybeSendVcChanceNotify(channel, guild, vcRooms, vcTotal, opts = {}) {
    // 改善①: 除外チャンネルを除いた実質人数でしきい値判定
    const effectiveTotal = calcEffectiveVcTotal(vcRooms);

    if (effectiveTotal < VC_CHANCE_THRESHOLD) {
        chanceStartedAt.delete(guild.id);
        return false;
    }
    if (!opts.ignoreCooldown && await isOnCooldown(guild.id)) {
        chanceStartedAt.delete(guild.id);
        return false;
    }

    if (!hasNoEntryFriendlyRoom(vcRooms)) {
        chanceStartedAt.delete(guild.id);
        return false;
    }

    const regularCount = countRegularsInVc(guild);
    if (regularCount === 0) {
        chanceStartedAt.delete(guild.id);
        return false;
    }

    const now = Date.now();
    if (!chanceStartedAt.has(guild.id)) {
        chanceStartedAt.set(guild.id, now);
        return false;
    }

    const elapsed = now - chanceStartedAt.get(guild.id);
    if (elapsed < CHANCE_WAIT_MS) return false;

    chanceStartedAt.delete(guild.id);

    const { flavor } = getTimeFlavor(); // 改善④

    const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle('🎤 VCが賑わってるよ！')
        .setDescription([
            `VCに **${effectiveTotal}人** いるのに、入りやすい部屋がないみたい。`,
            `新しく部屋を立てると、人が集まりやすいよ！`,
            `声かけてみようかな？ってなってる人、ぜひ 🎤`,
            flavor, // 改善④
        ].join('\n'))
        .setTimestamp();

    try {
        const updated = await editVcSlotMessage(channel, guild.id, embed, 'chance', opts);
        if (!updated) return false;

        if (!opts.ignoreCooldown) await setCooldown(guild.id);
        logger.info('vcnotifier.chance.updated', { guildId: guild.id, effectiveTotal, regularCount });
        return true;
    } catch (err) {
        logger.error('vcnotifier.chance.error', { guildId: guild.id, err: err?.message });
        return false;
    }
}

// ─────────────────────────────────────────────
// メイン: 両通知をまとめて評価
// ─────────────────────────────────────────────

async function evaluateVcNotifications(channel, guild, vcRooms, vcTotal, opts = {}) {
    const buzzSent = await maybeSendVcBuzzNotify(channel, guild, vcRooms, vcTotal, opts);
    if (!buzzSent) {
        await maybeSendVcChanceNotify(channel, guild, vcRooms, vcTotal, opts);
    }
}

module.exports = {
    evaluateVcNotifications,
    isEntryFriendly,
    isExcludedRecommendRoom,
    calcEffectiveVcTotal,
    // 改善③: スラッシュコマンドから呼び出せる除外ID管理API
    loadExcludedIds,
    addExcludedId,
    removeExcludedId,
    listExcludedIds,
};
