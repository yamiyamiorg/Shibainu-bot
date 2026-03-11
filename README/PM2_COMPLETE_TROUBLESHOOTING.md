
## 症状

- ✅ ローカル（`npm start`）: 動作する
- ✅ `/yami` と `/choco`: PM2でも動作する

## 原因の可能性

1. PM2のプロセスキャッシュ
2. Node.jsモジュールキャッシュ
3. イベントリスナーの重複登録
4. features.confの読み込みタイミング
5. データベースファイルのパーミッション

## 完全対処法（順番に実行）

### Step 1: PM2を完全にクリーンアップ

```bash
# 1. PM2プロセスを完全停止
pm2 stop yamichan-bot
pm2 delete yamichan-bot

# 2. PM2のログを削除
pm2 flush

# 3. PM2のキャッシュをクリア
rm -rf ~/.pm2/logs/*
rm -rf ~/.pm2/pids/*

# 4. PM2デーモンを再起動
pm2 kill
pm2 ping
```

### Step 2: Node.jsキャッシュをクリア

```bash
cd ~/yamichan-bot

# 1. node_modulesを削除
rm -rf node_modules/

# 2. package-lock.jsonを削除
rm -f package-lock.json

# 3. 再インストール
npm install
```

### Step 3: データベースのパーミッションを確認

```bash
# dataディレクトリの確認
ls -la data/

# パーミッションを修正
chmod 755 data/
chmod 644 data/*.sqlite 2>/dev/null || true

# 必要に応じて所有者を変更
sudo chown -R $(whoami):$(whoami) data/
```

### Step 4: features.confを確認

```bash
# 内容確認
cat features.conf

# 改行コードを確認（Windowsから転送した場合）
file features.conf

# 必要に応じてLFに変換
dos2unix features.conf 2>/dev/null || sed -i 's/\r$//' features.conf

# 読み取り権限を確認
chmod 644 features.conf
```

### Step 5: .envファイルを確認

```bash
# 内容確認
cat .env

# GEMINI_API_KEYがあるか
grep GEMINI_API_KEY .env

# 改行コードを修正
sed -i 's/\r$//' .env

# 権限を確認
chmod 600 .env
```

### Step 6: ecosystem.config.jsを最新版に置き換え

```bash
cat > ecosystem.config.js << 'EOF'
// ecosystem.config.js
const path = require('path');
const dotenv = require('dotenv');

// 明示的に.envを読み込む
const envPath = path.resolve(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('⚠️  .env file not found or error:', result.error);
} else {
  console.log('✅ .env loaded successfully');
}

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
EOF
```

### Step 7: ログディレクトリを作成

```bash
mkdir -p logs
chmod 755 logs
```

### Step 8: PM2で起動（デバッグモード）

```bash
# LOG_LEVELをdebugに設定
export LOG_LEVEL=debug

# PM2で起動
pm2 start ecosystem.config.js

# すぐにログを確認
pm2 logs yamichan-bot --lines 50
```

### Step 9: ログで確認すべきポイント

```bash
```

**期待される出力:**

```
✅ .env loaded successfully
```

**もし以下が出ていない場合、問題あり:**

```
```

### Step 10: Intentsを確認

Discord Developer Portalで以下を確認:

```
✅ Server Members Intent: ON
✅ Message Content Intent: ON
✅ Presence Intent: OFF（不要）
```

設定後、Botを再起動:

```bash
pm2 restart yamichan-bot
```

### Step 11: テスト実行

#### 歓迎メッセージのテスト

```bash
# ログをリアルタイムで監視
```

別ターミナルで Discord にアクセスし、テストチャンネルで「はじめまして」を送信。

**期待されるログ:**

```
```

#### VC通知のテスト

```bash
# ログをリアルタイムで監視
pm2 logs yamichan-bot --raw | grep vc_notify
```

対象VCに参加。

**期待されるログ:**

```
```

## 問題が解決しない場合の詳細診断

### 診断1: featureLoaderの確認

```bash
pm2 logs yamichan-bot | grep "bot.features"
```

**正常な場合:**
```
```

```
bot.features.loaded count=3 features=["yami","choco","health"]
```

→ features.confの読み込み失敗または無効化されている

### 診断2: features.confの読み込み確認

```bash
# Node.jsで直接読み込みテスト
node -e "
const { loadFeatureConfig } = require('./src/utils/featureConfig');
const config = loadFeatureConfig();
console.log('Config:', JSON.stringify(config, null, 2));
"
```

**期待される出力:**

```json
{
  "yami": { "enabled": true, "env": null },
  "choco": { "enabled": true, "env": null },
  "health": { "enabled": true, "env": null },
}
```

### 診断3: イベントリスナーの確認

```bash
# src/index.jsでリスナー数を確認
node -e "
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ]
});
console.log('MessageCreate listeners:', client.listenerCount('messageCreate'));
console.log('VoiceStateUpdate listeners:', client.listenerCount('voiceStateUpdate'));
"
```

### 診断4: メモリ内の状態確認

PM2で実行中のプロセスに接続:

```bash
# PM2のプロセスIDを確認
pm2 list

# プロセスの詳細情報
pm2 show yamichan-bot

# メモリ使用量を確認
pm2 monit
```

## 強制的な完全リセット手順

上記すべてを試しても解決しない場合:

```bash
#!/bin/bash
# complete-reset.sh

echo "🛑 Complete reset starting..."

# 1. PM2を完全停止
pm2 kill

# 2. すべてのNode.jsプロセスを停止（注意）
pkill -f node || true

# 3. プロジェクトファイルを退避
cd ~
mv yamichan-bot yamichan-bot-old

# 4. 新しくクローン（またはコピー）
# tar -xzf yamichan-bot-v2.3.1-fixed.tar.gz
# または
# git clone <repo> yamichan-bot

# 5. 設定ファイルをコピー
cp yamichan-bot-old/.env yamichan-bot/
cp yamichan-bot-old/features.conf yamichan-bot/

# 6. データベースをコピー
mkdir -p yamichan-bot/data
cp yamichan-bot-old/data/*.sqlite yamichan-bot/data/ 2>/dev/null || true

# 7. 依存関係インストール
cd yamichan-bot
npm install

# 8. パーミッション設定
chmod 600 .env
chmod 644 features.conf
chmod 755 data
chmod 644 data/*.sqlite 2>/dev/null || true

# 9. PM2起動
pm2 start ecosystem.config.js

# 10. ログ確認
pm2 logs yamichan-bot --lines 100

echo "✅ Complete reset done!"
```

## PM2特有の問題への対処

### 問題: PM2が古いコードを実行している

```bash
# PM2のアプリケーションキャッシュをクリア
pm2 delete yamichan-bot
rm -rf ~/.pm2/modules/node_modules/

# PM2自体を再インストール
npm uninstall -g pm2
npm install -g pm2

# 再起動
pm2 start ecosystem.config.js
```

### 問題: 環境変数が反映されない

```bash
# .envを直接PM2に読み込ませる
pm2 start ecosystem.config.js --env production --update-env

# または、起動時に明示的に指定
pm2 start src/index.js --name yamichan-bot \
  --node-args="--require dotenv/config" \
  --update-env
```

### 問題: ファイルディスクリプタの上限

```bash
# 上限を確認
ulimit -n

# 上限を増やす（一時的）
ulimit -n 4096

# PM2を再起動
pm2 kill
pm2 start ecosystem.config.js
```

## デバッグ用の追加ログ


```javascript
// デバッグ用
console.log('🔍 Process ID:', process.pid);
console.log('🔍 NODE_ENV:', process.env.NODE_ENV);
console.log('🔍 GEMINI_API_KEY exists:', !!process.env.GEMINI_API_KEY);
```

## 最終チェックリスト

- [ ] PM2を完全に停止・削除した（`pm2 kill`）
- [ ] node_modulesを削除して再インストールした
- [ ] .envファイルが存在し、正しい内容になっている
- [ ] ecosystem.config.jsが最新版になっている
- [ ] Discord Developer PortalでIntentsが有効
- [ ] dataディレクトリのパーミッションが正しい
- [ ] テストチャンネルIDが正しい（`1466983702667067475`）

## サポート用のログ収集

問題が解決しない場合、以下のコマンドでログを収集:

```bash
#!/bin/bash
# collect-debug-info.sh

echo "=== PM2 Status ===" > debug.log
pm2 list >> debug.log

echo -e "\n=== PM2 Env ===" >> debug.log
pm2 env 0 >> debug.log 2>&1

echo -e "\n=== Features Config ===" >> debug.log
cat features.conf >> debug.log

echo -e "\n=== Environment Variables ===" >> debug.log

echo -e "\n=== PM2 Logs (last 100 lines) ===" >> debug.log
pm2 logs yamichan-bot --lines 100 --nostream >> debug.log 2>&1

echo -e "\n=== Feature Loader Test ===" >> debug.log
node -e "
const { loadFeatureConfig } = require('./src/utils/featureConfig');
console.log(JSON.stringify(loadFeatureConfig(), null, 2));
" >> debug.log 2>&1

echo -e "\n=== File Permissions ===" >> debug.log
ls -la features.conf .env data/ >> debug.log 2>&1

echo "Debug info collected in debug.log"
```

実行:
```bash
chmod +x collect-debug-info.sh
./collect-debug-info.sh
cat debug.log
```

このログを共有いただければ、さらに詳細な診断ができます。
