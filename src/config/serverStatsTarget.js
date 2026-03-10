// src/config/serverStatsTarget.js
/**
 * サーバー統計機能の設定
 *
 * features.conf の値によって動作するサーバーが変わる:
 *   false       → 機能OFF（何もしない）
 *   true:test   → テストサーバーのみ
 *   true:prod   → 本番サーバー ＋ テストサーバー（両方同時更新）
 *
 * 返り値は { targets: [...] } の配列形式。
 * 複数サーバーを同時に更新するため、index.js 側でループして処理する。
 */

function getServerStatsConfig() {
    const { getFeatureEnv } = require('../utils/featureConfig');
    const confEnv = (getFeatureEnv('serverstats') || '').toLowerCase();
    const isProd = confEnv === 'prod' || confEnv === 'production';

    const updateInterval = process.env.SERVERSTATS_UPDATE_INTERVAL
        ? parseInt(process.env.SERVERSTATS_UPDATE_INTERVAL, 10)
        : 5; // 分

    // テストサーバー
    const TEST_TARGET = {
        label: 'test',
        guildId: process.env.SERVERSTATS_TEST_GUILD_ID || '1455097564759330958',
        statsChannelId: process.env.SERVERSTATS_TEST_CHANNEL_ID || '1473100058760183819',
    };

    // 本番サーバー
    const PROD_TARGET = {
        label: 'prod',
        guildId: process.env.SERVERSTATS_PROD_GUILD_ID || '1450709451488100396',
        statsChannelId: process.env.SERVERSTATS_PROD_CHANNEL_ID || '1473127167570477087',
    };

    // true:prod → 本番＋テスト両方
    // true:test → テストのみ
    const targets = isProd
        ? [PROD_TARGET, TEST_TARGET]
        : [TEST_TARGET];

    return {
        env: isProd ? 'prod' : 'test',
        targets,
        updateInterval,
    };
}

module.exports = { getServerStatsConfig };
