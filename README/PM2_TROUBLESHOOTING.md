# PM2 トラブルシューティングガイド

## 問題: PM2でリプライが動作しない

### 原因

PM2起動時に `.env` ファイルが正しく読み込まれていない可能性があります。

### 解決策

#### 方法1: ecosystem.config.jsを修正（推奨）

`ecosystem.config.js` の先頭に以下を追加:

```javascript
require('dotenv').config(); // 追加

module.exports = {
  apps: [{
    name: 'yamichan-bot',
    script: './src/index.js',
    env: {
      NODE_ENV: 'production',
      ...process.env  // 追加: .envの内容を渡す
    },
    // ...
  }]
};
```

#### 方法2: PM2起動コマンドを変更

```bash
# 通常の起動（問題あり）
pm2 start ecosystem.config.js

# 修正後の起動（.envを明示的に読み込む）
pm2 start ecosystem.config.js --update-env
```

または

```bash
# .envをsourceしてからpm2起動
export $(cat .env | xargs) && pm2 start ecosystem.config.js
```

#### 方法3: PM2の環境変数設定を使用

```bash
# .envの内容をPM2に登録
pm2 start ecosystem.config.js --update-env

# 環境変数を確認
pm2 env 0

# 特定の環境変数を設定
pm2 set pm2:yamichan-bot:GEMINI_API_KEY your_api_key_here
```

## 確認方法

### 1. PM2のログを確認

```bash
pm2 logs yamichan-bot --lines 100
```

期待されるログ:
```
welcome.feature.setup envTarget=test welcomeChannelId=...
welcome.message.trigger userId=... username=...
welcome.message.sent userId=... length=...
```

### 2. 環境変数が読み込まれているか確認

```bash
# PM2のプロセス情報を確認
pm2 show yamichan-bot

# 環境変数を確認
pm2 env 0
```

### 3. ローカルで動作確認

```bash
# PM2を使わずに直接起動
npm start

# または
node src/index.js
```

ローカルで動作する場合、PM2の環境変数読み込みに問題があります。

## PM2起動の正しい手順

### 初回起動

```bash
# 1. プロジェクトディレクトリに移動
cd ~/yamichan-bot

# 2. .envファイルがあることを確認
ls -la .env

# 3. ecosystem.config.jsを確認（require('dotenv').config()があるか）
head -5 ecosystem.config.js

# 4. PM2で起動
pm2 start ecosystem.config.js

# 5. ログ確認
pm2 logs yamichan-bot
```

### 再起動

```bash
# 設定ファイル変更後
pm2 restart yamichan-bot --update-env

# または完全に削除して再起動
pm2 delete yamichan-bot
pm2 start ecosystem.config.js
```

### 環境変数の更新

```bash
# .envを編集
nano .env

# PM2を再起動（重要: --update-env をつける）
pm2 restart yamichan-bot --update-env

# または
pm2 delete yamichan-bot
pm2 start ecosystem.config.js
```

## よくある問題と解決策

### 問題1: GEMINI_API_KEYが読み込まれない

**確認:**
```bash
pm2 env 0 | grep GEMINI_API_KEY
```

**解決:**
```bash
# ecosystem.config.jsに追加
require('dotenv').config();

# PM2再起動
pm2 delete yamichan-bot
pm2 start ecosystem.config.js
```

### 問題2: 歓迎メッセージが送信されない

**確認:**
```bash
pm2 logs yamichan-bot | grep welcome
```

**原因:**
- チャンネルIDが間違っている
- features.confで無効化されている
- 既に送信済み（DB確認）

**解決:**
```bash
# features.confを確認
cat features.conf | grep welcome

# welcome=true:test になっているか確認

# チャンネルIDを確認
pm2 logs yamichan-bot | grep "welcome.feature.setup"
```

### 問題3: VC通知が届かない

**確認:**
```bash
pm2 logs yamichan-bot | grep vc_notify
```

**原因:**
- GuildVoiceStates Intent が無効
- 対象VCが間違っている
- アカウント年齢が14日以上

**解決:**
```bash
# Discord Developer Portalで設定確認
# Server Members Intent: ON
# Message Content Intent: ON

# ログで対象VCを確認
pm2 logs yamichan-bot | grep targetVCCount
```

## デバッグモード

### ログレベルを変更

```bash
# .envを編集
nano .env

# 以下を追加または変更
LOG_LEVEL=debug

# 再起動
pm2 restart yamichan-bot --update-env
```

### リアルタイムログ監視

```bash
# すべてのログ
pm2 logs yamichan-bot --raw

# エラーのみ
pm2 logs yamichan-bot --err

# welcomeに関連するログのみ
pm2 logs yamichan-bot | grep welcome
```

## PM2とローカルの違い

| 項目 | ローカル (npm start) | PM2 |
|------|---------------------|-----|
| .env読み込み | ✅ 自動 | ⚠️ 明示的に必要 |
| 環境変数 | プロセスに直接 | ecosystem.config.js経由 |
| 再起動 | 手動 | 自動 |
| ログ | コンソール | ファイル |

## 推奨設定

### ecosystem.config.js（修正版）

```javascript
require('dotenv').config();

module.exports = {
  apps: [{
    name: 'yamichan-bot',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      ...process.env
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    listen_timeout: 3000,
    kill_timeout: 5000,
    wait_ready: false,
    shutdown_with_message: true
  }]
};
```

### デプロイスクリプト

```bash
#!/bin/bash
# deploy-pm2.sh

set -e

echo "📦 Pulling latest code..."
git pull

echo "📚 Installing dependencies..."
npm install

echo "🛑 Stopping PM2..."
pm2 delete yamichan-bot 2>/dev/null || true

echo "🚀 Starting with PM2..."
pm2 start ecosystem.config.js

echo "📋 Checking status..."
pm2 status

echo "✅ Deployment complete!"
echo "📊 View logs: pm2 logs yamichan-bot"
```

使い方:
```bash
chmod +x deploy-pm2.sh
./deploy-pm2.sh
```

## まとめ

PM2でBotが正しく動作しない場合:

1. ✅ `ecosystem.config.js` に `require('dotenv').config()` を追加
2. ✅ `.env` ファイルが存在することを確認
3. ✅ `pm2 delete yamichan-bot` してから `pm2 start ecosystem.config.js`
4. ✅ `pm2 logs yamichan-bot` でログを確認
5. ✅ ローカルで動作確認（`npm start`）

これで PM2 でも正常に動作するはずです！
