// src/features/serverstats/formatter.js
/**
 * サーバー統計のEmbedフォーマッター（統合版）
 *
 * 実装済み機能:
 *  A-1  変化率表示（前日スナップショットとの差分）
 *  A-2  天気予報（活気インデックス）
 *  A-3  聞き専への光
 *  A-4  マイルストーンカウントダウン
 *  A-5  植物インジケーター
 *  B-1  VC入りやすさ可視化（常連さん・入室ログ・出入り回数を追加）
 *  B-2  週次レポート（index.jsから呼ばれる）
 *  B-3  経過日数・直近24h新規参加数・最終参加経過時間
 *  A-6  キーワードトレンド
 *  C-1  日記活動量表示
 */

const { EmbedBuilder } = require('discord.js');
const { isEntryFriendly } = require('./vcNotifier');

const MILESTONE_TARGETS = (process.env.SERVERSTATS_MILESTONES || '1500,2000,3000,5000')
    .split(',').map(Number).filter(n => n > 0).sort((a, b) => a - b);

// ─────────────────────────────────────────────
// メイン：Embedを組み立てる
// ─────────────────────────────────────────────

/**
 * @param {object} stats
 * @param {object|null} prev
 * @param {number} joinCount24h
 * @param {Date|null} guildCreatedAt
 * @param {Array} vcRooms
 * @param {Array} keywords
 * @param {number|null} diaryReactionCount24h
 * @param {number|null} lastJoinUnix
 * @param {object|null} allTimePeaks
 * @param {Map<string,{regularCount:number,lastEntry:number|null,todayEntries:number}>} vcRoomMeta
 */
function buildStatsEmbed(
    stats,
    prev = null,
    joinCount24h = 0,
    guildCreatedAt = null,
    vcRooms = [],
    keywords = [],
    diaryReactionCount24h = null,
    lastJoinUnix = null,
    allTimePeaks = null,
    vcRoomMeta = new Map(),
) {
    const weather   = calcWeather(stats);
    const plant     = calcPlant(stats);
    const milestone = calcMilestone(stats.allMembers);
    const elapsed   = guildCreatedAt ? calcElapsed(guildCreatedAt) : null;

    const embed = new EmbedBuilder()
        .setColor(weatherColor(weather.level))
        .setTitle(`${weather.emoji} サーバー状況　${plant.emoji}`)
        .setDescription(buildDescription(weather, plant, milestone, elapsed, joinCount24h, lastJoinUnix));

    // 👥 Members
    embed.addFields({
        name: '👥 Members',
        value: [
            `> 全員: **${fmt(stats.allMembers)}** ${diff(stats.allMembers, prev?.all_members)}`,
            `> 人間: ${fmt(stats.members)}　Bot: ${fmt(stats.bots)}`,
            `> オンライン: **${fmt(stats.onlineMembers)}** ${diff(stats.onlineMembers, prev?.online)}`,
        ].join('\n'),
        inline: false,
    });

    // 📈 歴代ピーク
    if (allTimePeaks && (allTimePeaks.peak_vc > 0 || allTimePeaks.peak_online > 0)) {
        const peakVcAt = allTimePeaks.peak_vc_at    ? formatJST(allTimePeaks.peak_vc_at)    : '?';
        const peakOnAt = allTimePeaks.peak_online_at ? formatJST(allTimePeaks.peak_online_at) : '?';
        embed.addFields({
            name: '📈 歴代ピーク',
            value: [
                `> 🎤 最多VC同時接続: **${fmt(allTimePeaks.peak_vc)}名**（${peakVcAt}）`,
                `> 🟢 最多オンライン:  **${fmt(allTimePeaks.peak_online)}名**（${peakOnAt}）`,
            ].join('\n'),
            inline: false,
        });
    }

    // 🎤 Voice Channels
    embed.addFields({
        name: '🎤 Voice Channels',
        value: [
            `> VC参加中: **${fmt(stats.vcTotal)}** ${diff(stats.vcTotal, prev?.vc_total)}`,
            `> 🗣️ 話し中: ${fmt(stats.vcTalking)} ${diff(stats.vcTalking, prev?.vc_talking)}`,
            `> 🎧 聴き専: ${fmt(stats.vcListening)} ${diff(stats.vcListening, prev?.vc_listening)}　← 静かに参加中`,
            `> 👀 見てるだけ: ${fmt(stats.vcWatching)}`,
        ].join('\n'),
        inline: false,
    });

    // 🏠 VC部屋の雰囲気（常連さん・入室ログ付き）
    const activeRooms = vcRooms.filter(r => r.total > 0).slice(0, 6);
    if (activeRooms.length > 0) {
        const roomLines = activeRooms.map(r => {
            const meta       = vcRoomMeta.get(r.id) || {};
            const badge      = vcRoomBadge(r);
            const friendly   = isEntryFriendly(r);

            const hints = [];

            // 常連さんがいる
            if (meta.regularCount > 0) {
                hints.push(`常連${meta.regularCount}人`);
            }

            // 直近の入室タイムスタンプ
            if (meta.lastEntry) {
                const elapsed = formatElapsedSince(meta.lastEntry);
                hints.push(`${elapsed}前に入室あり`);
            }

            // 今日の出入り回数（にぎわい感）
            if (meta.todayEntries > 0) {
                hints.push(`今日${meta.todayEntries}回の出入り`);
            }

            // 入りやすさを文言に
            let entryHint = '';
            if (friendly && hints.length > 0) {
                entryHint = ` ✨ 入りやすいかも`;
            }

            const hintStr = hints.length > 0 ? `*(${hints.join('・')})*` : '';
            if (hintStr || entryHint) {
                return `> ${badge} **${r.name}**　${r.total}名\n> ${hintStr}${entryHint}`.trimEnd();
            }
            return `> ${badge} **${r.name}**　${r.total}名`;
        });

        embed.addFields({
            name: '🏠 VC部屋の雰囲気',
            value: roomLines.join('\n'),
            inline: false,
        });
    }

    // 📁 Server
    embed.addFields({
        name: '📁 Server',
        value: [
            `> チャンネル: ${fmt(stats.channels)}　ロール: ${fmt(stats.roles)}`,
            `> Boostレベル: ${stats.boostLevel}　Boost数: ${fmt(stats.boostCount)}`,
        ].join('\n'),
        inline: false,
    });

    // 📔 秘密の日記
    if (diaryReactionCount24h !== null && diaryReactionCount24h > 0) {
        embed.addFields({
            name: '📔 秘密の日記',
            value: `> 直近24hで **${diaryReactionCount24h}件** の投稿に誰かが寄り添いました`,
            inline: false,
        });
    }

    // 💬 今のキーワード（A-6）
    if (keywords.length > 0) {
        const kwText = keywords.map(k => `\`${k.word}\``).join('　');
        embed.addFields({
            name: '💬 直近のキーワード',
            value: `> ${kwText}`,
            inline: false,
        });
    }

    embed.setFooter({ text: `最終更新` });
    embed.setTimestamp();

    return embed;
}

// ─────────────────────────────────────────────
// 週次レポート Embed（analytics統合版）
// ─────────────────────────────────────────────

/**
 * @param {object} guild
 * @param {object} peak          { vc_total, recorded_at }
 * @param {Array}  hourlyAvg     [{ dow, hour, avg_vc }]
 * @param {object|null} msgStats { active_users, total_messages }
 * @param {Array}  topEmojis     [{ emoji, total }]
 * @param {number} newJoinCount  1週間の新規参加数
 */
function buildSummaryReportEmbed(title, peak, hourlyAvg, msgStats, topEmojis, newJoinCount, emptyText) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title)
        .setTimestamp();

    const lines = [];

    // VC ピーク
    if (peak && peak.vc_total > 0) {
        const pd      = new Date((peak.recorded_at + 32400) * 1000);
        const dowName = ['日', '月', '火', '水', '木', '金', '土'][pd.getUTCDay()];
        lines.push(`🏆 **ピークVC**: ${dowName}曜日 ${pd.getUTCHours()}時台（最大 **${peak.vc_total}名**）`);
    }

    // 賑わいやすい時間帯 TOP3
    if (hourlyAvg.length > 0) {
        const dowNames = ['日', '月', '火', '水', '木', '金', '土'];
        const top3 = [...hourlyAvg]
            .sort((a, b) => b.avg_vc - a.avg_vc)
            .slice(0, 3)
            .map(r => `${dowNames[r.dow]}曜 ${r.hour}時台（平均${r.avg_vc.toFixed(1)}名）`)
            .join('、');
        lines.push(`🕐 **賑わいやすい時間帯**: ${top3}`);
        lines.push(`> イベントの開催目安にどうぞ 🎉`);
    }

    // テキスト活動
    if (msgStats && msgStats.active_users > 0) {
        lines.push(`💬 **発言した人**: ${msgStats.active_users}人（${msgStats.total_messages}件のメッセージ）`);
    }

    // よく使われた絵文字 TOP3
    if (topEmojis && topEmojis.length > 0) {
        const emojiStr = topEmojis.slice(0, 3).map(e => `${e.emoji}(${e.total}回)`).join('　');
        lines.push(`✨ **よく使われた絵文字**: ${emojiStr}`);
    }

    // 新規参加
    if (newJoinCount > 0) {
        lines.push(`🆕 **新しく仲間になった人**: ${newJoinCount}人`);
    }

    if (lines.length === 0) {
        lines.push(emptyText || 'まだデータが少ないです。');
    }

    embed.setDescription(lines.join('\n'));
    return embed;
}

function buildWeeklyReportEmbed(guild, peak, hourlyAvg, msgStats, topEmojis, newJoinCount) {
    return buildSummaryReportEmbed(
        '📊 先週のサーバーまとめ',
        peak,
        hourlyAvg,
        msgStats,
        topEmojis,
        newJoinCount,
        '先週分のデータがまだ少ないです。次週の更新を待っててね 🌱'
    );
}

function buildCumulativeReportEmbed(guild, peak, topMoments, hourlyAvg, msgWeeklyAvg, topEmojis, joinWeeklyAvg) {
    const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle('📈 累計のサーバーまとめ')
        .setTimestamp();

    const lines = [];

    if (peak && peak.vc_total > 0) {
        lines.push(`🏆 **ピークVC**: ${formatMomentJst(peak.recorded_at)}（最大 **${peak.vc_total}名**）`);
    }

    if (topMoments && topMoments.length > 0) {
        const topStr = topMoments
            .slice(0, 3)
            .map((r) => `${formatMomentJst(r.recorded_at)}（${r.vc_total}名）`)
            .join('、');
        lines.push(`🕐 **賑わいやすい時間帯（実測TOP3）**: ${topStr}`);
    }

    if (msgWeeklyAvg && (msgWeeklyAvg.avg_active_users || msgWeeklyAvg.avg_total_messages)) {
        const avgUsers = Number(msgWeeklyAvg.avg_active_users || 0).toFixed(1);
        const avgMsgs = Number(msgWeeklyAvg.avg_total_messages || 0).toFixed(1);
        lines.push(`💬 **発言の週平均**: ${avgUsers}人 / ${avgMsgs}件`);
    }

    if (topEmojis && topEmojis.length > 0) {
        const emojiStr = topEmojis.slice(0, 3).map(e => `${e.emoji}(${e.total}回)`).join('　');
        lines.push(`✨ **よく使われた絵文字（累計）**: ${emojiStr}`);
    }

    if (joinWeeklyAvg && joinWeeklyAvg.avg_joins != null) {
        const avgJoins = Number(joinWeeklyAvg.avg_joins || 0).toFixed(1);
        lines.push(`🆕 **新しく仲間になった人（週平均）**: ${avgJoins}人`);
    }

    if (lines.length === 0) {
        lines.push('累計データがまだ少ないです。時間とともに充実していきます 🌱');
    }

    embed.setDescription(lines.join('\n'));

    const heatmapTable = buildWeeklyHeatmapTable(hourlyAvg || []);
    if (heatmapTable) {
        embed.addFields({
            name: '📅 曜日×時間帯の込み具合',
            value: heatmapTable,
            inline: false,
        });
    }

    return embed;
}

// ─────────────────────────────────────────────
// A-1  差分表示
// ─────────────────────────────────────────────

function diff(current, prevValue) {
    if (prevValue == null) return '';
    const delta = current - prevValue;
    if (delta === 0) return '`±0`';
    if (delta > 0)   return `\`+${delta}\``;
    return `\`${delta}\``;
}

// ─────────────────────────────────────────────
// A-2  天気予報（活気インデックス）
// ─────────────────────────────────────────────

function calcWeather(stats) {
    if (stats.allMembers === 0) return { level: 0, emoji: '🌙', label: '静かな夜' };

    const score = Math.min(100,
        (stats.vcTotal   * 4)
        + (stats.vcTalking * 3)
        + (stats.onlineMembers)
    );

    if (score >= 60) return { level: 3, emoji: '☀️',  label: '快晴・賑やか' };
    if (score >= 30) return { level: 2, emoji: '🌤️', label: '晴れ・のんびり' };
    if (score >= 10) return { level: 1, emoji: '☁️',  label: '曇り・静か' };
    return { level: 0, emoji: '🌙', label: '夜・ひっそり' };
}

function weatherColor(level) {
    return [0x5865F2, 0x4f86f7, 0xffd700, 0xff8c00][level] ?? 0x5865F2;
}

// ─────────────────────────────────────────────
// A-5  植物インジケーター
// ─────────────────────────────────────────────

function calcPlant(stats) {
    const score = stats.vcTotal * 4 + stats.vcTalking * 3 + stats.onlineMembers;
    if (score >= 80) return { emoji: '🌸', label: '満開' };
    if (score >= 40) return { emoji: '🌳', label: '大きく育ち中' };
    if (score >= 15) return { emoji: '🌿', label: '育ち中' };
    return { emoji: '🌱', label: '静かに成長中' };
}

// ─────────────────────────────────────────────
// A-4  マイルストーンカウントダウン
// ─────────────────────────────────────────────

function calcMilestone(allMembers) {
    const next = MILESTONE_TARGETS.find(t => t > allMembers);
    if (!next) return null;
    return { next, remaining: next - allMembers };
}

// ─────────────────────────────────────────────
// B-1  VC部屋の入りやすさバッジ
// ─────────────────────────────────────────────

function vcRoomBadge(room) {
    if (room.total === 0) return '⚪';
    if (room.limit > 0 && room.total >= room.limit) return '🔴';  // 満員
    if (room.total > 0 && room.watching === room.total) return '⚫'; // 全員ミュート・垢放置感
    if (room.talking === 0 && room.listening > 0) return '🔵';   // 全員聴き専・まったり
    if (room.talking >= 3) return '🟡';                           // 盛り上がり中
    return '🟢';                                                   // 話しかけやすそう
}

// ─────────────────────────────────────────────
// B-3  経過日数
// ─────────────────────────────────────────────

function calcElapsed(createdAt) {
    return Math.floor((Date.now() - createdAt.getTime()) / 86400000);
}

// ─────────────────────────────────────────────
// Description（ヘッダー）
// ─────────────────────────────────────────────

function buildDescription(weather, plant, milestone, elapsedDays, joinCount24h, lastJoinUnix) {
    const lines = [];
    lines.push(`**${weather.label}**　今のサーバーの空気感です`);
    lines.push(`サーバーの活気：${plant.emoji} ${plant.label}`);

    if (milestone) {
        lines.push(`🎯 次の目標まで **あと ${fmt(milestone.remaining)} 人** （${fmt(milestone.next)}人）`);
    }
    if (elapsedDays !== null) {
        lines.push(`🗓️ サーバー開設から **${elapsedDays}日目**`);
    }
    if (joinCount24h > 0) {
        lines.push(`🆕 直近24hで **${joinCount24h}人** が新しく参加しました`);
    }
    if (lastJoinUnix) {
        lines.push(`👤 最後に仲間が加わったのは **${formatElapsedSince(lastJoinUnix)}前**`);
    }

    return lines.join('\n');
}

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

function fmt(n) {
    return typeof n === 'number' ? n.toLocaleString() : String(n ?? 0);
}

function formatJST(unixSec) {
    const d   = new Date((unixSec + 32400) * 1000);
    const mo  = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const hr  = d.getUTCHours();
    return `${mo}/${day} ${hr}時頃`;
}

function formatElapsedSince(unixSec) {
    const sec = Math.floor(Date.now() / 1000) - unixSec;
    if (sec < 60)    return `${sec}秒`;
    if (sec < 3600)  return `${Math.floor(sec / 60)}分`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}時間`;
    return `${Math.floor(sec / 86400)}日`;
}

function formatMomentJst(unixSec) {
    const d = new Date((unixSec + 32400) * 1000);
    const dowName = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${dowName}) ${d.getUTCHours()}時台`;
}

function toBand(hour) {
    if (hour >= 5 && hour <= 8) return 'early';
    if (hour >= 9 && hour <= 12) return 'morning';
    if (hour >= 13 && hour <= 18) return 'afternoon';
    return 'late';
}

function buildWeeklyHeatmapTable(hourlyAvg) {
    const days = [1, 2, 3, 4, 5, 6, 0]; // 月〜日
    const dayNames = ['月', '火', '水', '木', '金', '土', '日'];
    const bands = ['early', 'morning', 'afternoon', 'late'];

    const cell = new Map();
    for (const d of days) {
        for (const b of bands) cell.set(`${d}:${b}`, []);
    }

    for (const row of hourlyAvg) {
        const key = `${row.dow}:${toBand(Number(row.hour))}`;
        if (cell.has(key)) cell.get(key).push(Number(row.avg_vc || 0));
    }

    const values = [];
    for (const arr of cell.values()) {
        const v = arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
        values.push(v);
    }
    if (values.every((v) => v === 0)) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)] || 0;
    const q2 = sorted[Math.floor((sorted.length - 1) * 0.50)] || 0;
    const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)] || 0;

    function toEmoji(v) {
        if (v >= q3) return '🔥';
        if (v >= q2) return '🟡';
        if (v >= q1) return '🟢';
        return '🌙';
    }

    const lines = [];
    lines.push('`曜日  早朝  午前  午後  深夜`');
    for (let i = 0; i < days.length; i++) {
        const d = days[i];
        const ems = bands.map((b) => {
            const arr = cell.get(`${d}:${b}`) || [];
            const avg = arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
            return toEmoji(avg);
        });
        lines.push(`\`${dayNames[i]}曜  ${ems[0]}    ${ems[1]}    ${ems[2]}    ${ems[3]}\``);
    }
    lines.push('🔥超人気 / 🟡人が多め / 🟢あまり人がいない / 🌙とても人が少ない');
    return lines.join('\n');
}

module.exports = {
    buildStatsEmbed,
    buildWeeklyReportEmbed,
    buildCumulativeReportEmbed,
    vcRoomBadge,
};
