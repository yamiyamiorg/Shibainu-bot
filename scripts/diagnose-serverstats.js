// scripts/diagnose-serverstats.js
/**
 * ServerStats機能の診断スクリプト
 * 
 * 使い方:
 * node scripts/diagnose-serverstats.js
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { getServerStatsConfig } = require('../src/config/serverStatsTarget');

console.log('='.repeat(60));
console.log('ServerStats機能 診断ツール');
console.log('='.repeat(60));
console.log();

// 設定を読み込み
const config = getServerStatsConfig();

console.log('📋 現在の設定:');
console.log('-'.repeat(60));
console.log(`対象サーバーID: ${config.targetGuildId}`);
console.log(`表示フォーマット: ${config.format}`);
console.log(`VC変化時更新: ${config.updateOnVCChange}`);
console.log();

console.log('🔍 Botトークンチェック:');
console.log('-'.repeat(60));
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.log('❌ DISCORD_TOKEN が .env に設定されていません');
  console.log();
  console.log('解決方法:');
  console.log('.env ファイルに以下を追加:');
  console.log('DISCORD_TOKEN=your_bot_token_here');
  console.log();
  process.exit(1);
}
console.log('✅ DISCORD_TOKEN が設定されています');
console.log();

console.log('🤖 Botに接続してギルド情報を確認中...');
console.log('-'.repeat(60));

// Botクライアントを作成
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`✅ Botにログインしました: ${client.user.tag}`);
  console.log();

  console.log('📊 Botが参加しているサーバー一覧:');
  console.log('-'.repeat(60));
  
  if (client.guilds.cache.size === 0) {
    console.log('❌ Botはどのサーバーにも参加していません');
    console.log();
    console.log('解決方法:');
    console.log('1. Discord Developer Portal でBotを招待URLを作成');
    console.log('2. サーバーにBotを招待');
    console.log();
    client.destroy();
    process.exit(1);
  }

  client.guilds.cache.forEach((guild, idx) => {
    const isTarget = String(guild.id) === String(config.targetGuildId);
    const marker = isTarget ? '✅ [対象サーバー]' : '  ';
    console.log(`${marker} ${guild.name}`);
    console.log(`   ID: ${guild.id}`);
    console.log(`   メンバー数: ${guild.memberCount}`);
    console.log();
  });

  console.log('🎯 対象サーバーチェック:');
  console.log('-'.repeat(60));
  
  const targetGuild = client.guilds.cache.get(config.targetGuildId);
  
  if (!targetGuild) {
    console.log('❌ 対象サーバーにBotが参加していません');
    console.log();
    console.log(`設定されている対象サーバーID: ${config.targetGuildId}`);
    console.log();
    console.log('✅ 解決方法:');
    console.log('1. 上記の「Botが参加しているサーバー一覧」から正しいIDをコピー');
    console.log('2. src/config/serverStatsTarget.js を編集');
    console.log('   または .env に以下を追加:');
    console.log(`   SERVERSTATS_GUILD_ID=正しいサーバーID`);
    console.log();
    console.log('例:');
    if (client.guilds.cache.size > 0) {
      const firstGuild = client.guilds.cache.first();
      console.log(`SERVERSTATS_GUILD_ID=${firstGuild.id}`);
    }
    console.log();
    client.destroy();
    process.exit(1);
  }

  console.log('✅ 対象サーバーにBotが参加しています');
  console.log(`サーバー名: ${targetGuild.name}`);
  console.log(`サーバーID: ${targetGuild.id}`);
  console.log(`メンバー数: ${targetGuild.memberCount}`);
  console.log();

  console.log('🎤 VCチャンネルチェック:');
  console.log('-'.repeat(60));
  
  const voiceChannels = targetGuild.channels.cache.filter(ch => ch.type === 2);
  
  if (voiceChannels.size === 0) {
    console.log('⚠️  VCチャンネルが見つかりません');
    console.log('（サーバーにVCがない、またはBotに権限がない可能性）');
  } else {
    console.log(`✅ ${voiceChannels.size}個のVCチャンネルが見つかりました:`);
    voiceChannels.forEach(vc => {
      const memberCount = vc.members.size;
      console.log(`   - ${vc.name} (${memberCount}人)`);
    });
  }
  console.log();

  console.log('✅ 診断完了！');
  console.log('='.repeat(60));
  console.log();
  console.log('📝 次のステップ:');
  console.log('1. pm2 restart yamichan-bot');
  console.log('2. pm2 logs yamichan-bot | grep serverstats');
  console.log('3. Botのステータスに統計が表示されることを確認');
  console.log();

  client.destroy();
  process.exit(0);
});

client.on('error', (err) => {
  console.error('❌ Bot接続エラー:', err.message);
  process.exit(1);
});

// ログイン
client.login(token).catch(err => {
  console.error('❌ Botログイン失敗:', err.message);
  console.log();
  console.log('解決方法:');
  console.log('1. DISCORD_TOKEN が正しいか確認');
  console.log('2. Bot トークンを再生成');
  console.log();
  process.exit(1);
});

// タイムアウト（30秒）
setTimeout(() => {
  console.log('❌ タイムアウト: Bot接続に時間がかかりすぎています');
  process.exit(1);
}, 30000);
