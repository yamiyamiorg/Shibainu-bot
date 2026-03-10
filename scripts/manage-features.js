#!/usr/bin/env node
// scripts/manage-features.js
// 機能の有効/無効を管理するCLIツール

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../features.conf');

// 色定義
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * 設定ファイルを読み込む
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(colorize('❌ features.conf が見つかりません', 'red'));
    process.exit(1);
  }

  const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
  const config = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(true|false)$/);
    if (match) {
      const [, name, value] = match;
      config[name] = value === 'true';
    }
  }

  return config;
}

/**
 * 設定を保存
 */
function saveConfig(config) {
  const lines = [];
  
  // ヘッダー
  lines.push('# features.conf');
  lines.push('# 機能の有効/無効を管理する設定ファイル');
  lines.push('# true = 有効, false = 無効');
  lines.push('');

  // 各機能
  const descriptions = {
    yami: 'Yami機能（AI会話）',
    choco: 'Choco機能（画像共有）',
    health: 'Health機能（ステータス監視）',
    example: 'Example機能（テンプレート）',
  };

  for (const [name, value] of Object.entries(config)) {
    if (descriptions[name]) {
      lines.push(`# ${descriptions[name]}`);
    }
    lines.push(`${name}=${value}`);
    lines.push('');
  }

  fs.writeFileSync(CONFIG_FILE, lines.join('\n'), 'utf-8');
}

/**
 * 機能一覧を表示
 */
function listFeatures() {
  const config = loadConfig();
  
  console.log(colorize('\n📋 機能一覧\n', 'cyan'));
  console.log('─'.repeat(50));
  
  for (const [name, enabled] of Object.entries(config)) {
    const status = enabled 
      ? colorize('✅ 有効', 'green')
      : colorize('❌ 無効', 'red');
    console.log(`${name.padEnd(15)} ${status}`);
  }
  
  console.log('─'.repeat(50));
  console.log(colorize('\n💡 変更: node scripts/manage-features.js enable/disable <機能名>', 'gray'));
  console.log(colorize('💡 反映: pm2 restart yamichan-bot\n', 'gray'));
}

/**
 * 機能を有効化
 */
function enableFeature(featureName) {
  const config = loadConfig();

  if (!(featureName in config)) {
    console.error(colorize(`❌ 機能 "${featureName}" が見つかりません`, 'red'));
    process.exit(1);
  }

  if (config[featureName]) {
    console.log(colorize(`ℹ️  ${featureName} は既に有効です`, 'yellow'));
    return;
  }

  config[featureName] = true;
  saveConfig(config);

  console.log(colorize(`✅ ${featureName} を有効化しました`, 'green'));
  console.log(colorize(`\n反映するには: pm2 restart yamichan-bot`, 'cyan'));
}

/**
 * 機能を無効化
 */
function disableFeature(featureName) {
  const config = loadConfig();

  if (!(featureName in config)) {
    console.error(colorize(`❌ 機能 "${featureName}" が見つかりません`, 'red'));
    process.exit(1);
  }

  if (!config[featureName]) {
    console.log(colorize(`ℹ️  ${featureName} は既に無効です`, 'yellow'));
    return;
  }

  config[featureName] = false;
  saveConfig(config);

  console.log(colorize(`✅ ${featureName} を無効化しました`, 'green'));
  console.log(colorize(`\n反映するには: pm2 restart yamichan-bot`, 'cyan'));
}

/**
 * ヘルプを表示
 */
function showHelp() {
  console.log(colorize('\n🤖 やみちゃんBot - 機能管理ツール\n', 'cyan'));
  console.log('使い方:');
  console.log('  node scripts/manage-features.js <コマンド> [引数]\n');
  console.log('コマンド:');
  console.log('  list                  機能一覧を表示');
  console.log('  enable <機能名>       機能を有効化');
  console.log('  disable <機能名>      機能を無効化');
  console.log('  help                  このヘルプを表示\n');
  console.log('例:');
  console.log('  node scripts/manage-features.js list');
  console.log('  node scripts/manage-features.js enable choco');
  console.log('  node scripts/manage-features.js disable choco\n');
  console.log(colorize('💡 変更後は pm2 restart yamichan-bot で反映してください', 'gray'));
  console.log('');
}

// メイン処理
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'list':
    listFeatures();
    break;

  case 'enable':
    if (!args[1]) {
      console.error(colorize('❌ 機能名を指定してください', 'red'));
      console.log('例: node scripts/manage-features.js enable choco');
      process.exit(1);
    }
    enableFeature(args[1]);
    break;

  case 'disable':
    if (!args[1]) {
      console.error(colorize('❌ 機能名を指定してください', 'red'));
      console.log('例: node scripts/manage-features.js disable choco');
      process.exit(1);
    }
    disableFeature(args[1]);
    break;

  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;

  default:
    console.error(colorize('❌ 不明なコマンドです', 'red'));
    showHelp();
    process.exit(1);
}
