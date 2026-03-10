// src/config/analyticsTarget.js
/**
 * アナリティクス機能の設定
 *
 * ★ 設計原則:
 *   データ収集・集計の対象は「常に本番サーバー（PROD_GUILD_ID）」
 *   レポート投稿先チャンネルだけが features.conf の設定によって変わる。
 *
 *   つまり、ボットをテストサーバーに設置していても本番サーバーのメッセージ・VCを
 *   集計してレポートする。本番サーバーに設置した場合も同様。
 *
 * features.conf の analytics の値:
 *   false       → 機能OFF
 *   true:test   → テストサーバーのチャンネルにレポートを投稿  ← 規定値
 *   true:prod   → 本番サーバーのチャンネルにレポートを投稿
 *
 * 【本番投入時の手順】
 *   1. features.conf の analytics を true:prod に変更
 *   2. .env に ANALYTICS_PROD_CHANNEL_ID を設定（analyticsTarget.js の PROD_REPORT_CHANNEL_ID 参照）
 *   3. ボット再起動
 */

function getAnalyticsConfig() {
  const { getFeatureEnv } = require('../utils/featureConfig');
  const confEnv = (getFeatureEnv('analytics') || '').toLowerCase();
  const isProd  = confEnv === 'prod' || confEnv === 'production';

  // ── データ収集・集計対象（常に本番サーバー固定） ──────────────────────
  const DATA_GUILD_ID = process.env.ANALYTICS_PROD_GUILD_ID || '1450709451488100396';

  // ── レポート投稿先チャンネル（設置環境によって変わる） ────────────────
  // true:test → テストサーバーのチャンネルに投稿（規定値）
  const TEST_REPORT_CHANNEL_ID = process.env.ANALYTICS_TEST_CHANNEL_ID || '';

  // true:prod → 本番サーバーのチャンネルに投稿
  // ★ 本番投入時: 下の行のコメントを解除し、その下の空文字行を削除すること
  // const PROD_REPORT_CHANNEL_ID = process.env.ANALYTICS_PROD_CHANNEL_ID || '';
  const PROD_REPORT_CHANNEL_ID = '';  // 本番チャンネルID未設定（意図的）— true:prod 運用開始まで使わない

  // ── ターゲット定義 ─────────────────────────────────────────────────────
  // dataGuildId: 集計対象サーバー（常に本番）
  // reportGuildId: レポート投稿先サーバー（設置先）
  // reportChannelId: レポート投稿先チャンネル

  const TEST_TARGET = {
    label:           'test',
    dataGuildId:     DATA_GUILD_ID,                    // 本番サーバーのデータを集計
    reportGuildId:   process.env.ANALYTICS_TEST_GUILD_ID || '1455097564759330958',
    reportChannelId: TEST_REPORT_CHANNEL_ID,
  };

  const PROD_TARGET = {
    label:           'prod',
    dataGuildId:     DATA_GUILD_ID,                    // 本番サーバーのデータを集計
    reportGuildId:   DATA_GUILD_ID,                    // 本番サーバーのチャンネルに投稿
    reportChannelId: PROD_REPORT_CHANNEL_ID,
  };

  // true:prod → 本番チャンネルに投稿 / true:test → テストチャンネルに投稿
  const target = isProd ? PROD_TARGET : TEST_TARGET;

  return {
    env:    isProd ? 'prod' : 'test',
    target,                                 // 単一ターゲット（複数同時投稿はしない）
    // 日次レポートを送信する時刻（JST）
    dailyHour:   Number(process.env.ANALYTICS_DAILY_HOUR   ?? 7),
    dailyMinute: Number(process.env.ANALYTICS_DAILY_MINUTE ?? 0),
  };
}

module.exports = { getAnalyticsConfig };
