
## エラー内容

```
Cannot find module 'better-sqlite3'
```

## 原因

`better-sqlite3` パッケージがインストールされていません。

## 解決法

### 方法1: npm install（推奨）

```bash
cd ~/yamichan-bot

# better-sqlite3をインストール
npm install better-sqlite3

# PM2を再起動
pm2 restart yamichan-bot

# ログ確認
```

### 方法2: package.jsonを確認

```bash
# package.jsonにbetter-sqlite3があるか確認
grep better-sqlite3 package.json
```

**出力例（正常）:**
```json
"better-sqlite3": "^11.7.0"
```

**もし含まれていない場合:**

```bash
# 手動で追加
npm install --save better-sqlite3

# または、最新のpackage.jsonに置き換え
# （v2.3.2に含まれています）
```

### 方法3: 完全再インストール

```bash
cd ~/yamichan-bot

# node_modulesを削除
rm -rf node_modules/
rm -f package-lock.json

# 再インストール
npm install

# PM2再起動
pm2 restart yamichan-bot
```

## 確認方法

```bash
# better-sqlite3がインストールされているか確認
npm list better-sqlite3

# 期待される出力:
# yamichan-bot@2.3.0
# └── better-sqlite3@11.7.0
```

## トラブルシューティング

### エラー: コンパイルに失敗する

**Linuxの場合:**

```bash
# ビルドツールをインストール
sudo apt-get update
sudo apt-get install -y build-essential python3

# 再インストール
npm install better-sqlite3
```

**Node.jsバージョンが古い場合:**

```bash
# Node.jsバージョン確認
node -v

# 推奨: v18以上
# バージョンが古い場合はアップグレード
```

### エラー: 権限がない

```bash
# npmのグローバル権限を修正
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) ~/yamichan-bot/node_modules

# 再インストール
npm install
```

## デプロイ後の確認

```bash
# 1. インストール確認
npm list better-sqlite3

# 2. PM2再起動
pm2 restart yamichan-bot

# 3. エラーログ確認
pm2 logs yamichan-bot --err --lines 20

```

期待されるログ:
```json
{
  "level": "info",
  "envTarget": "test"
}
```

## package.json の正しい内容

```json
{
  "name": "yamichan-bot",
  "version": "2.3.0",
  "dependencies": {
    "@google/genai": "^1.39.0",
    "@google/generative-ai": "^0.21.0",
    "discord.js": "^14.25.1",
    "dotenv": "^17.2.3",
    "better-sqlite3": "^11.7.0"
  }
}
```

## クイックフィックス（1コマンド）

```bash
cd ~/yamichan-bot && npm install better-sqlite3 && pm2 restart yamichan-bot && pm2 logs yamichan-bot
```
