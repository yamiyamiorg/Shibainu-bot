/**
 * src/config/boostTarget.js
 *
 * サーバーIDで通知先チャンネルを決定する。
 * 環境変数による上書きにも対応。
 */

// ギルドID → 設定のマッピング（ハードコード）
// ★ channel_unavailable が出たら以下を確認:
//   1. .env に BOOST_CHANNEL_ID が設定されていないか（空ならOK、誤値なら削除）
//   2. ハードコードのチャンネルIDがDiscord上で存在するか
//   3. Botがそのチャンネルへの送信権限を持っているか
const GUILD_MAP = {
  '1450709451488100396': { env: 'prod', channelId: '1452263017348857896' }, // 本番サーバー → 😛雑談掲示板😉
  '1455097564759330958': { env: 'test', channelId: '1473078389442351277' }, // テストサーバー → 😛テスト😉
};

// 未知のサーバーへのフォールバック（念のため）
const FALLBACK = { env: 'unknown', channelId: null };

function getBoostTargetsForGuild(guildId) {
  const base = GUILD_MAP[String(guildId)] ?? FALLBACK;

  // 環境変数による上書き
  // ★ 空文字や未設定の場合はハードコード値を使う（誤設定で channel_unavailable にならないよう）
  const envChannelId =
    base.env === 'test'
      ? process.env.BOOST_TEST_CHANNEL_ID?.trim()
      : process.env.BOOST_CHANNEL_ID?.trim();

  const channelId = envChannelId || base.channelId;

  return {
    env: base.env,
    channelId,
    guildId: String(guildId),
  };
}

module.exports = { getBoostTargetsForGuild };
