// scripts/diagnose-boost.js
/**
 * Boost機能の診断スクリプト
 * 
 * 使い方:
 * node scripts/diagnose-boost.js [YOUR_USER_ID]
 * 
 * 例:
 * node scripts/diagnose-boost.js 902878433799979078
 */

const path = require('path');
const { getBoostTargets } = require('../src/config/boostTarget');

// 引数からユーザーIDを取得
const userIdToCheck = process.argv[2];

console.log('='.repeat(60));
console.log('Boost機能 診断ツール');
console.log('='.repeat(60));
console.log();

// 設定を読み込み
const config = getBoostTargets();

console.log('📋 現在の設定:');
console.log('-'.repeat(60));
console.log(`環境: ${config.env}`);
console.log(`ブースト通知チャンネルID: ${config.boostChannelId}`);
console.log(`テストユーザー数: ${config.testUserIds.length}`);
console.log();

console.log('👥 登録されているテストユーザーID:');
console.log('-'.repeat(60));
config.testUserIds.forEach((id, idx) => {
  console.log(`${idx + 1}. ${id} (型: ${typeof id})`);
});
console.log();

// ユーザーIDチェック
if (userIdToCheck) {
  console.log('🔍 ユーザーID照合:');
  console.log('-'.repeat(60));
  console.log(`チェック対象: ${userIdToCheck} (型: ${typeof userIdToCheck})`);
  
  // 完全一致チェック
  const exactMatch = config.testUserIds.includes(userIdToCheck);
  console.log(`完全一致 (includes): ${exactMatch ? '✅ YES' : '❌ NO'}`);
  
  // String変換後の一致チェック
  const stringMatch = config.testUserIds.some(id => String(id) === String(userIdToCheck));
  console.log(`String変換後一致: ${stringMatch ? '✅ YES' : '❌ NO'}`);
  
  // 数値変換後の一致チェック（Snowflakeは大きすぎて不正確になる可能性あり）
  const numberMatch = config.testUserIds.some(id => Number(id) === Number(userIdToCheck));
  console.log(`Number変換後一致: ${numberMatch ? '⚠️ YES (非推奨)' : '❌ NO'}`);
  
  console.log();
  
  if (!stringMatch) {
    console.log('❌ 問題発見:');
    console.log('-'.repeat(60));
    console.log('このユーザーIDはテストユーザーとして登録されていません。');
    console.log();
    console.log('✅ 解決方法:');
    console.log('src/config/boostTarget.js を確認し、');
    console.log('testUserIds 配列にこのIDを追加してください。');
    console.log();
    console.log('例:');
    console.log(`testUserIds: ['${userIdToCheck}', ...],`);
  } else {
    console.log('✅ このユーザーIDは正しく登録されています！');
    console.log();
    console.log('📝 テストコマンド:');
    console.log('-'.repeat(60));
    console.log('Discordで以下のコマンドを送信してください:');
    console.log('  !testboost');
    console.log('または');
    console.log('  !boost');
    console.log();
    console.log('期待される動作:');
    console.log(`1. コマンドメッセージが削除される`);
    console.log(`2. チャンネル ${config.boostChannelId} にブースト感謝メッセージが送信される`);
  }
  console.log();
} else {
  console.log('💡 使い方:');
  console.log('-'.repeat(60));
  console.log('特定のユーザーIDをチェックするには:');
  console.log('node scripts/diagnose-boost.js [YOUR_USER_ID]');
  console.log();
  console.log('例:');
  console.log('node scripts/diagnose-boost.js 902878433799979078');
  console.log();
}

console.log('🔧 トラブルシューティング:');
console.log('-'.repeat(60));
console.log('1. features.conf を確認');
console.log('   boost=true:test または boost=true:prod が設定されているか');
console.log();
console.log('2. Bot を再起動');
console.log('   pm2 restart yamichan-bot');
console.log();
console.log('3. ログを確認');
console.log('   pm2 logs yamichan-bot --lines 50 | grep boost');
console.log();
console.log('4. 期待されるログ:');
console.log('   - boost.feature.setup');
console.log('   - boost.test_user.registered');
console.log('   - boost.message_received (コマンド送信時)');
console.log('   - boost.test_event.triggered (成功時)');
console.log('   - boost.send_message.success (送信成功時)');
console.log();
console.log('5. よくある問題:');
console.log('   - ユーザーIDが testUserIds に含まれていない');
console.log('   - コマンドの前後に空白がある（厳密に "!testboost" である必要がある）');
console.log('   - Bot に Send Messages 権限がない');
console.log('   - チャンネルIDが間違っている');
console.log();

console.log('='.repeat(60));
console.log('診断完了');
console.log('='.repeat(60));
