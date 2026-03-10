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
  // ===== img機能 =====
  {
    name: 'img',
    description: '画像生成 (プリセット組み立て or 完全自由入力)',
    options: [
      {
        name: 'mode',
        description: '入力モードを選択',
        type: 3,
        required: true,
        choices: [
          { name: 'プリセットを使う', value: 'preset' },
          { name: 'プリセットを使わない（完全自由入力）', value: 'free' },
        ],
      },
      {
        name: 'style',
        description: '画風・ジャンル（preset時に使用）',
        type: 3,
        required: false,
        choices: [
          { name: '人物', value: 'portrait' },
          { name: '動物', value: 'animal' },
          { name: 'イラスト風', value: 'illustration' },
          { name: 'アニメ風', value: 'anime' },
          { name: '写実風', value: 'photorealistic' },
          { name: 'シネマ風', value: 'cinematic' },
        ],
      },
      {
        name: 'main',
        description: 'メインの被写体（自由入力）',
        type: 3,
        required: false,
      },
      {
        name: 'scene',
        description: 'シチュエーション・表情・雰囲気（自由入力）',
        type: 3,
        required: false,
      },
      {
        name: 'prompt',
        description: '完全自由入力（free時に使用）',
        type: 3,
        required: false,
      },
    ],
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
