// src/features/serverstats/regularScore.js
/**
 * 常連スコア計算
 *
 * 目的: 「入りやすい」と感じさせる顔なじみメンバーを特定する。
 *
 * 対象条件（AND）:
 *   - なじんだメンバーロール所持
 *   - おふぃさーロール非所持（管理者は除外）
 *   - サーバー加入から14日以上経過
 *   - 現在VCにいる
 *
 * スコア計算（直近14日）:
 *   - VC参加日数 × 3点         … 継続して来ている安心感
 *   - 発話時間割合 × 10点      … 放置・垢繋ぎ放置を除外
 *   - 異なる部屋参加数 × 1点   … いろんな場所に顔を出す人
 */

const db = require('./db');

// 環境変数からロールIDを読み込む
const OFFICER_ROLE_ID  = process.env.OFFICER_ROLE_ID  || '1451915537033597108';
const REGULAR_ROLE_ID  = process.env.REGULAR_ROLE_ID  || '1451908949409534093';

const JOIN_DAYS_MIN    = 14;   // 加入後14日以上経過
const SCORE_VC_DAYS    = 3;    // VC参加日数の重み
const SCORE_SPEAK_RATE = 10;   // 発話率の重み
const SCORE_ROOMS      = 1;    // 部屋数の重み
const TOP_N            = 3;    // 表示する常連数

/**
 * 現在VCにいるメンバーから常連スコアを計算し、上位N人を返す。
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} guildId
 * @returns {Promise<Array<{userId: string, score: number}>>}
 */
async function getTopRegulars(guild, guildId) {
    try {
        // 直近14日のVC集計をDBから取得
        const activityRows = await db.getVcActivityRange(guildId, 14);
        if (!activityRows || activityRows.length === 0) return [];

        // userId → 集計データ のマップ
        const actMap = new Map();
        for (const row of activityRows) {
            actMap.set(row.user_id, row);
        }

        const now14DaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const scored = [];

        for (const [, member] of guild.members.cache) {
            if (!member.voice?.channelId) continue; // VCにいない
            if (member.user.bot) continue;

            const userId = member.id;

            // おふぃさー除外
            if (member.roles.cache.has(OFFICER_ROLE_ID)) continue;

            // なじんだメンバーのみ
            if (!member.roles.cache.has(REGULAR_ROLE_ID)) continue;

            // 加入14日以上
            if (!member.joinedTimestamp || member.joinedTimestamp > now14DaysAgo) continue;

            const act = actMap.get(userId);
            if (!act) continue; // 直近14日のVC記録なし → 常連ではない

            // 発話率（vc_active_minutes / vc_total_minutes、0除算防止）
            const speakRate = act.total_vc_minutes > 0
                ? Math.min(1, act.total_active_minutes / act.total_vc_minutes)
                : 0;

            const score =
                (act.vc_days      || 0) * SCORE_VC_DAYS
                + speakRate            * SCORE_SPEAK_RATE
                + (act.room_count || 0) * SCORE_ROOMS;

            if (score > 0) scored.push({ userId, score });
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP_N);
    } catch (err) {
        // スコア計算エラーは表示に影響させない
        return [];
    }
}

module.exports = { getTopRegulars, OFFICER_ROLE_ID, REGULAR_ROLE_ID };
