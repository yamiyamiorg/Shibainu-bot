// src/config/target.js
/**
 * guildId で本番/テストを自動判別する設計。
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
  },
  // テストサーバー
  '1455097564759330958': {
    env: 'test',
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

  const testUserIds = process.env.TEST_USER_IDS
    ? splitIds(process.env.TEST_USER_IDS)
    : TEST_USER_IDS.map(String);

  return {
    env: base.env,
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
