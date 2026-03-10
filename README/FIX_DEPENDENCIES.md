# Welcome機能が動作しない場合の対処法

## ❌ エラー: Cannot find module 'better-sqlite3'

### 即座の解決法（1コマンド）

```bash
./scripts/fix-dependencies.sh
```

または

```bash
npm install better-sqlite3 && pm2 restart yamichan-bot
```

---

## 📋 手動での対処法

### Step 1: better-sqlite3をインストール

```bash
cd ~/yamichan-bot
npm install better-sqlite3
```

### Step 2: PM2を再起動

```bash
pm2 restart yamichan-bot
```

### Step 3: ログで確認

```bash
pm2 logs yamichan-bot | grep welcome
```

**期待されるログ:**
```json
{
  "level": "info",
  "event": "welcome.feature.setup",
  "envTarget": "test"
}
```

---

## 🔍 インストールの確認

```bash
# better-sqlite3がインストールされているか確認
npm list better-sqlite3
```

**正常な出力:**
```
yamichan-bot@2.3.2
└── better-sqlite3@11.7.0
```

---

## ⚠️ インストールエラーが出る場合

### Linux（Ubuntu/Debian）

```bash
# ビルドツールをインストール
sudo apt-get update
sudo apt-get install -y build-essential python3

# 再インストール
npm install better-sqlite3
```

### Node.jsバージョンが古い

```bash
# バージョン確認
node -v

# 推奨: v18.0.0 以上
# アップグレードが必要な場合:
# https://nodejs.org/
```

---

## 🚀 完全な再インストール

```bash
cd ~/yamichan-bot

# 1. node_modulesを削除
rm -rf node_modules/
rm -f package-lock.json

# 2. package.jsonを最新版に更新（v2.3.2）
# （アーカイブに含まれています）

# 3. 依存関係を再インストール
npm install

# 4. PM2再起動
pm2 restart yamichan-bot

# 5. 確認
pm2 logs yamichan-bot | grep welcome
```

---

## 📊 トラブルシューティング

### 問題: "Permission denied" エラー

```bash
# npmの権限を修正
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) ~/yamichan-bot/node_modules

# 再インストール
npm install better-sqlite3
```

### 問題: "gyp ERR!" エラー

```bash
# ビルドツールとPythonをインストール
sudo apt-get install -y build-essential python3

# node-gypを更新
npm install -g node-gyp

# 再インストール
npm install better-sqlite3
```

### 問題: PM2で起動してもエラー

```bash
# PM2を完全リセット
pm2 delete yamichan-bot
pm2 kill

# 再起動
pm2 start ecosystem.config.js

# ログ確認
pm2 logs yamichan-bot
```

---

## ✅ 動作確認

### 1. 依存関係の確認

```bash
npm list better-sqlite3
# → better-sqlite3@11.7.0 が表示されればOK
```

### 2. PM2ログの確認

```bash
pm2 logs yamichan-bot | grep -E "(feature|welcome)"
```

**期待される出力:**
```
bot.features.loaded count=4 features=["yami","choco","health","welcome"]
welcome.feature.setup envTarget=test
```

### 3. データベースファイルの確認

```bash
ls -la data/
# → welcome.sqlite が作成されていればOK（初回実行後）
```

### 4. Discord でテスト

チャンネル `1466983702667067475` で「はじめまして」を送信

**期待されるログ:**
```
welcome.message.trigger userId=...
welcome.message.sent userId=...
```

---

## 📦 正しい package.json

```json
{
  "name": "yamichan-bot",
  "version": "2.3.2",
  "dependencies": {
    "@google/genai": "^1.39.0",
    "@google/generative-ai": "^0.21.0",
    "better-sqlite3": "^11.7.0",
    "discord.js": "^14.25.1",
    "dotenv": "^17.2.3"
  }
}
```

---

## 🎯 まとめ

**better-sqlite3 が必要な理由:**
- Welcome機能の歓迎履歴を保存するため
- 1人1回制限を実現するため

**インストールされていない場合:**
- Welcome機能が読み込まれない
- エラーログに "Cannot find module 'better-sqlite3'" と表示

**解決法:**
```bash
npm install better-sqlite3
pm2 restart yamichan-bot
```

これで完全に動作します！
