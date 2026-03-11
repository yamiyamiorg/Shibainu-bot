// src/deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { logger } = require('./services/logger');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Error: DISCORD_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

// 登録先サーバー（両方に同じコマンドを登録）
const TARGET_GUILDS = [
  { id: '1450709451488100396', label: '本番サーバー' },
  { id: '1455097564759330958', label: 'テストサーバー' },
  { id: '1467295635752489003', label: 'テストサーバー2' },
];

// 全コマンド定義
const commands = [
  // ===== Choco機能 =====
  {
    name: 'choco',
    description: 'ランダムな画像を表示',
  },

  // ===== Health機能 =====
  {
    name: 'status',
    description: 'ボットのステータスを表示',
  },

  // ===== Wiki機能 =====
  {
    name: 'wiki',
    description: 'Wikipediaから要約を取得',
    options: [
      {
        name: 'keyword',
        description: '検索したい言葉',
        type: 3,
        required: true,
      },
    ],
  },

  // ===== Omikuji機能 =====
  {
    name: 'omikuji',
    description: 'やみちゃんがおみくじを引いてくれる（全100パターン）',
  },
];

// ===== デプロイ処理 =====
console.log('📋 登録するコマンド:');
commands.forEach((cmd, i) => {
  console.log(`  ${i + 1}. /${cmd.name} - ${cmd.description}`);
});
console.log();

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  let allSuccess = true;

  for (const guild of TARGET_GUILDS) {
    console.log(`⏳ [${guild.label}] (${guild.id}) に登録中...`);

    try {
      const data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guild.id),
        { body: commands }
      );

      console.log(`✅ [${guild.label}] ${data.length}個のコマンドを登録しました`);
      logger.info('deploy.guild.success', {
        guildId: guild.id,
        label: guild.label,
        count: data.length,
      });
    } catch (error) {
      console.error(`❌ [${guild.label}] 登録に失敗しました: ${error?.message}`);
      logger.error('deploy.guild.failed', {
        guildId: guild.id,
        label: guild.label,
        err: error?.message,
        stack: error?.stack,
      });
      allSuccess = false;
    }
  }

  console.log();

  if (allSuccess) {
    console.log('🎉 全サーバーへの登録が完了しました！');
    console.log('💡 Discordで "/" を入力すると確認できます');
  } else {
    console.error('⚠️  一部のサーバーへの登録に失敗しました。ログを確認してください。');
    process.exit(1);
  }
})();
