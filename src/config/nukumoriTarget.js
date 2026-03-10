// src/config/nukumoriTarget.js
/**
 * ぬくもり可視化システムの設定
 * - features.conf の nukumori=true:test なら testID群
 * - features.conf の nukumori=true:prod なら prodID群
 * - ENV_TARGET環境変数でも上書き可能
 */

function getEnvTarget() {
    // 1. features.conf から読み取り
    const { getFeatureEnv } = require('../utils/featureConfig');
    const confEnv = getFeatureEnv('nukumori');
    
    // 2. 環境変数 ENV_TARGET で上書き可能
    const envTarget = process.env.ENV_TARGET;
    
    if (envTarget) {
        const normalized = envTarget.trim().toLowerCase();
        const env = normalized === 'prod' || normalized === 'production' ? 'prod' : 'test';
        return env;
    }
    
    // 3. features.conf の設定を使用
    if (confEnv) {
        const normalized = confEnv.trim().toLowerCase();
        return normalized === 'prod' || normalized === 'production' ? 'prod' : 'test';
    }
    
    // 4. デフォルトはtest
    return 'test';
}

function getNukumoriConfig() {
    const env = getEnvTarget();

    const TEST = {
        targetChannels: [
            '1466983702667067475', // テスト環境の雑談
            '1473088856000692409', // 😛テスト😉
        ],
        targetEmojis: [
            '❤️',
            '💚',
            '🫶',
            '🤝',
            '🌱',
            '🪽',
        ],
        reportChannelId: '1473088856000692409', // 😛テスト😉
    };

    const PROD = {
        targetChannels: [
            '1452263017348857896', // 😛雑談掲示板😉
            '1451873523047071808', // 🥺今日の報告
            '1462387547350106145', // 📜懺悔の部屋
            '1471831121351147532', // 🏥匿名SOSチャット
        ],
        targetEmojis: [
            '❤️',
            '💚',
            '🫶',
            '🤝',
            '🌱',
            '🪽',
        ],
        reportChannelId: '1452263017348857896', // 😛雑談掲示板😉
    };

    const base = env === 'prod' ? PROD : TEST;

    // 環境変数で個別上書き可能
    const targetChannels = process.env.NUKUMORI_TARGET_CHANNELS
        ? process.env.NUKUMORI_TARGET_CHANNELS.split(',').map(s => s.trim())
        : base.targetChannels;

    const targetEmojis = process.env.NUKUMORI_TARGET_EMOJIS
        ? process.env.NUKUMORI_TARGET_EMOJIS.split(',').map(s => s.trim())
        : base.targetEmojis;

    const reportChannelId = process.env.NUKUMORI_REPORT_CHANNEL_ID || base.reportChannelId;

    return {
        env,
        targetChannels: targetChannels.map(String),
        targetEmojis: targetEmojis.map(String),
        reportChannelId: String(reportChannelId),
    };
}

module.exports = { getNukumoriConfig };
