// src/config/diaryReactionTarget.js
/**
 * 日記へのAI絵文字リアクション機能の設定
 *
 * features.conf の値によって対象チャンネルが変わる:
 *   false       → 機能OFF
 *   true:test   → テストサーバーのフォーラムのみ
 *   true:prod   → 本番フォーラム ＋ テストフォーラム（両方同時監視）
 */

function getDiaryReactionConfig() {
    const { getFeatureEnv } = require('../utils/featureConfig');
    const confEnv = (getFeatureEnv('diaryreaction') || '').toLowerCase();
    const isProd = confEnv === 'prod' || confEnv === 'production';

    // テストサーバーのフォーラムチャンネルID
    const TEST_CHANNEL = process.env.DIARY_FORUM_CHANNEL_ID_TEST || '1474228055336812584';

    // 本番サーバーのフォーラムチャンネルID
    const PROD_CHANNEL = process.env.DIARY_FORUM_CHANNEL_ID_PROD
        || process.env.DIARY_FORUM_CHANNEL_ID
        || '1452467574636941414';

    // true:prod → 本番＋テスト両方
    // true:test → テストのみ
    const forumChannelIds = isProd
        ? [PROD_CHANNEL, TEST_CHANNEL]
        : [TEST_CHANNEL];

    return {
        env: isProd ? 'prod' : 'test',

        // 監視対象フォーラムチャンネルIDの配列
        forumChannelIds: forumChannelIds.map(String),

        // リアクションを付けるまでの遅延（ミリ秒）
        delayMinMs: Number(process.env.DIARY_REACTION_DELAY_MIN_MS ?? 30_000),   // 30秒
        delayMaxMs: Number(process.env.DIARY_REACTION_DELAY_MAX_MS ?? 120_000),  // 2分

        // Geminiに渡す最大文字数
        maxContentLength: Number(process.env.DIARY_REACTION_MAX_CONTENT ?? 800),

        // 1投稿に付ける絵文字の数
        reactionCount: Number(process.env.DIARY_REACTION_COUNT ?? 3),
    };
}

module.exports = { getDiaryReactionConfig };
