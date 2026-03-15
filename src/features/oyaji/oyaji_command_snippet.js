// deploy-commands.js への追記分
//
// 既存の commands 配列に以下を追加する。
// import 部分に SlashCommandBuilder が既にあれば追記不要。
//
// ─────────────────────────────────────────────────────────────────
//
//   const { SlashCommandBuilder } = require('discord.js');
//
//   // commands 配列に追加:
//
// ─────────────────────────────────────────────────────────────────

const oyajiCommand = new SlashCommandBuilder()
  .setName('oyaji')
  .setDescription('故郷のおやじBot')
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('VCにおやじを呼ぶ')
  )
  .addSubcommand((sub) =>
    sub
      .setName('say')
      .setDescription('おやじに話しかける')
      .addStringOption((opt) =>
        opt
          .setName('text')
          .setDescription('話しかける内容')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('現在の人生段階と関係の深さを確認する')
  )
  .addSubcommand((sub) =>
    sub
      .setName('leave')
      .setDescription('おやじを帰す')
  )
  .addSubcommand((sub) =>
    sub
      .setName('help')
      .setDescription('コマンドの使い方を見る')
  );

// ── featureLoader.js の ALLOWED_FEATURES への追記 ────────────────
//
//   const ALLOWED_FEATURES = new Set([
//     'yami', 'serverstats', 'health', 'boost', 'welcome',
//     'newbievc', 'fantasy',
//     'oyaji',   // ← これを追加
//   ]);
//
// ── features.conf への追記 ───────────────────────────────────────
//
//   oyaji=true:test
//
// ── .env への追記（任意）────────────────────────────────────────
//
//   # おやじBot 専用 DB（省略時: data/oyaji.db）
//   OYAJI_DB_PATH=./data/oyaji.db
//

module.exports = { oyajiCommand };
