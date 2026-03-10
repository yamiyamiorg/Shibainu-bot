# 運用メモ - やみちゃんBot

## サーバー環境

### GCP Compute Engine 推奨スペック
- **マシンタイプ**: e2-micro または e2-small
- **OS**: Ubuntu 22.04 LTS
- **ディスク**: 10GB (標準永続ディスク)
- **リージョン**: asia-northeast1 (東京) または asia-northeast2 (大阪)

### 必要なソフトウェア
- Node.js v16.x 以上 (推奨: v18.x LTS)
- npm
- PM2 (グローバルインストール)
- Git (デプロイ時)

## 初回セットアップ

### 1. GCPインスタンス作成

```bash
# GCPコンソールでCompute Engineインスタンスを作成
# または gcloud CLI使用
gcloud compute instances create yamichan-bot \
  --machine-type=e2-small \
  --zone=asia-northeast1-a \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=10GB
```

### 2. サーバーにSSH接続

```bash
gcloud compute ssh yamichan-bot --zone=asia-northeast1-a
```

### 3. Node.jsインストール

```bash
# nvm経由でインストール（推奨）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# または apt経由
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 4. PM2インストール

```bash
npm install -g pm2
```

### 5. リポジトリクローン

```bash
cd ~
git clone <your-repository-url> yamichan-bot
cd yamichan-bot
```

### 6. 環境変数設定

```bash
cp .env.example .env
nano .env  # または vim

# 以下を設定
# DISCORD_TOKEN=...
# CLIENT_ID=...
# GEMINI_API_KEY=...
# その他必要に応じて
```

### 7. デプロイ実行

```bash
chmod +x deploy.sh
./deploy.sh
```

## 日常運用

### ボット状態確認

```bash
# PM2のステータス確認
pm2 status

# 詳細情報
pm2 info yamichan-bot

# リアルタイムモニタリング
pm2 monit
```

### ログ確認

```bash
# リアルタイムログ
pm2 logs yamichan-bot

# 最近のログ（100行）
pm2 logs yamichan-bot --lines 100

# エラーログのみ
pm2 logs yamichan-bot --err

# ファイルで確認
tail -f logs/error.log
tail -f logs/out.log
```

### 再起動・停止

```bash
# 再起動
pm2 restart yamichan-bot

# 停止
pm2 stop yamichan-bot

# 削除（停止＋プロセスリストから削除）
pm2 delete yamichan-bot
```

### コード更新時

```bash
cd ~/yamichan-bot

# 最新コードを取得
git pull

# 依存関係更新（必要な場合）
npm install

# コマンド再登録（コマンド変更時のみ）
npm run deploy:commands

# 再起動
pm2 restart yamichan-bot
```

## トラブルシューティング

### ボットが起動しない

```bash
# ログを確認
pm2 logs yamichan-bot --lines 50

# よくある原因:
# 1. .envファイルが正しく設定されていない
# 2. DISCORD_TOKENが無効
# 3. ポート競合（通常は不要）
# 4. メモリ不足
```

### メモリ不足

```bash
# メモリ使用状況確認
pm2 monit

# メモリ上限を超えたら自動再起動
# ecosystem.config.js で設定済み: max_memory_restart: '500M'

# GCPインスタンスのメモリ確認
free -h
```

### データベースエラー

```bash
# データベース再初期化
npm run db:init

# データベースファイルを確認
ls -lh data/yami.sqlite

# バックアップから復元
cp data/yami.sqlite.backup data/yami.sqlite
```

### Discordコマンドが表示されない

```bash
# コマンド再登録
npm run deploy:commands

# Discordクライアントで/コマンド一覧を確認
# 反映に数分かかる場合あり
```

## バックアップ

### データベースバックアップ

```bash
# 定期的にバックアップ（cronで自動化推奨）
cp data/yami.sqlite data/yami.sqlite.backup.$(date +%Y%m%d)

# 古いバックアップを削除（30日以上前）
find data/ -name "yami.sqlite.backup.*" -mtime +30 -delete
```

### 自動バックアップ設定（cron）

```bash
crontab -e

# 毎日午前3時にバックアップ
0 3 * * * cd ~/yamichan-bot && cp data/yami.sqlite data/yami.sqlite.backup.$(date +\%Y\%m\%d)

# 古いバックアップを削除（毎週日曜日）
0 4 * * 0 find ~/yamichan-bot/data/ -name "yami.sqlite.backup.*" -mtime +30 -delete
```

## パフォーマンスモニタリング

### PM2モニタリング

```bash
# リアルタイムモニタリング
pm2 monit

# メトリクス
pm2 show yamichan-bot
```

### システムリソース確認

```bash
# CPU・メモリ使用率
top

# ディスク使用量
df -h

# ネットワーク状況
netstat -tunlp
```

## セキュリティ

### ファイアウォール設定

```bash
# GCPファイアウォールルール
# Botは外部からのHTTP/HTTPSアクセス不要
# SSH (22)のみ許可でOK
```

### 環境変数の保護

```bash
# .envファイルのパーミッション確認
ls -la .env

# 600に設定（所有者のみ読み書き可）
chmod 600 .env
```

### 定期アップデート

```bash
# システムパッケージ更新
sudo apt update && sudo apt upgrade -y

# Node.js依存関係更新
npm audit fix

# セキュリティパッチのみ
npm audit fix --only=prod
```

## スケーリング

### 負荷が高い場合

1. **GCPインスタンスのスペックアップ**
   ```bash
   # インスタンス停止
   gcloud compute instances stop yamichan-bot
   
   # マシンタイプ変更
   gcloud compute instances set-machine-type yamichan-bot \
     --machine-type=e2-medium
   
   # 再起動
   gcloud compute instances start yamichan-bot
   ```

2. **メモリ上限を上げる**
   - `ecosystem.config.js` の `max_memory_restart` を調整

## 緊急時対応

### ボットが暴走している

```bash
# 即座に停止
pm2 stop yamichan-bot

# プロセスを完全に削除
pm2 delete yamichan-bot
```

### ディスク容量不足

```bash
# ログファイルを削除
pm2 flush yamichan-bot

# 古いログを削除
rm -f logs/*.log

# データベースバックアップを削除
rm -f data/yami.sqlite.backup.*
```

## 連絡先・エスカレーション

### ログの重要度

- **ERROR**: 即座に対応が必要
- **WARN**: 監視が必要だが緊急ではない
- **INFO**: 通常の動作
- **DEBUG**: 開発時のデバッグ情報

### アラート設定（推奨）

```bash
# PM2 Plusを使った監視（有料）
pm2 plus

# またはカスタムアラート設定
# - Discordへの通知
# - メール通知
# - Slackへの通知
```

## チェックリスト

### 日次チェック
- [ ] `pm2 status` でボットが稼働中
- [ ] ログにERRORがないか確認

### 週次チェック
- [ ] メモリ使用量の確認
- [ ] ディスク使用量の確認
- [ ] データベースバックアップの確認

### 月次チェック
- [ ] システムパッケージの更新
- [ ] Node.js依存関係の更新
- [ ] セキュリティ監査 (`npm audit`)
- [ ] 古いログ・バックアップの削除
