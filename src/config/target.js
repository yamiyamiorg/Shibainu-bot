// src/config/target.js
/**
 * guildId で本番/テストを自動判別する設計。
 * features.conf の welcome=true:prod/test は「どちらを有効にするか」ではなく
 * 「機能自体のON/OFF」としてのみ使用。
 * 本番・テスト両サーバーに同時接続している場合も正しく動作する。
 */

function splitIds(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ギルドID → 設定マッピング
const GUILD_CONFIG = {
  // 本番サーバー
  '1450709451488100396': {
    env: 'prod',
    welcomeChannelId: '1464999838130245742',
    notificationChannelId: '1464999838130245742',
    guideRoleId: '1452478070652141729',
    targetVCIds: [
      '1452111129332416512',
      '1461288337687183411',
      '1467877616844410901',
    ],
  },
  // テストサーバー
  '1455097564759330958': {
    env: 'test',
    welcomeChannelId: '1466983702667067475',
    notificationChannelId: '1466983702667067475',
    guideRoleId: '1472086791837454419',
    targetVCIds: [
      '1455097565367369764',
      '1452111129332416512',
      '1461288337687183411',
      '1467877616844410901',
    ],
  },
};

// テストユーザーID（環境共通）
const TEST_USER_IDS = ['1107669393049128961', '902878433799979078'];

/**
 * guildId を受け取って対応する設定を返す。
 * 未知のサーバーは null を返す。
 */
function getTargetsForGuild(guildId) {
  const base = GUILD_CONFIG[String(guildId)];
  if (!base) return null;

  const testUserIds = process.env.WELCOME_TEST_USER_IDS
    ? splitIds(process.env.WELCOME_TEST_USER_IDS)
    : TEST_USER_IDS.map(String);

  return {
    env: base.env,
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID || base.welcomeChannelId,
    notificationChannelId: process.env.WELCOME_NOTIFICATION_CHANNEL_ID || base.notificationChannelId,
    guideRoleId: process.env.WELCOME_GUIDE_ROLE_ID || base.guideRoleId,
    targetVCIds: process.env.WELCOME_TARGET_VC_IDS
      ? splitIds(process.env.WELCOME_TARGET_VC_IDS)
      : base.targetVCIds.map(String),
    testUserIds,
  };
}

/**
 * 後方互換用。guildId なしで呼ばれた場合は prod を返す。
 * 新しいコードは getTargetsForGuild(guildId) を使うこと。
 */
function getTargets() {
  return getTargetsForGuild('1450709451488100396');
}

module.exports = { getTargets, getTargetsForGuild };
