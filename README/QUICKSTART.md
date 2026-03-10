# 開発者向けクイックスタートガイド

## 5分でローカル起動

### 1. 必要な環境

- Node.js 16.x 以上
- npm または yarn
- Discord Bot Token
- (オプション) Google Gemini API Key

### 2. インストール

```bash
# リポジトリをクローン(または解凍)
cd unified-bot

# 依存関係をインストール
npm install
```

### 3. 環境変数設定

```bash
# .env.exampleをコピー
cp .env.example .env

# .envを編集(最低限以下を設定)
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
```

### 4. Discord Bot設定

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. New Application → Bot作成
3. Bot Token をコピーして `.env` の `DISCORD_TOKEN` に設定
4. Application ID をコピーして `.env` の `CLIENT_ID` に設定
5. OAuth2 → URL Generator で以下を選択:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`
6. 生成されたURLでボットを招待

### 5. 機能別セットアップ

#### Yami機能を使う場合

```bash
# Gemini API Keyを設定
GEMINI_API_KEY=your_key_here

# データベース初期化
npm run db:init
```

#### Choco機能を使う場合

```bash
# 画像フォルダを作成
mkdir images

# テスト用画像を配置
# (任意の .png, .jpg, .gif などを images/ に入れる)

# .envに設定
CHOCO_DIR=./images
```

### 6. コマンド登録

```bash
npm run deploy:commands
```

### 7. 起動

```bash
# 開発モード(自動リロード)
npm run dev

# 本番モード
npm start
```

## トラブルシューティング

### ❌ "Missing DISCORD_TOKEN"
→ `.env` ファイルが正しく作成されているか確認

### ❌ コマンドが表示されない
→ `npm run deploy:commands` を実行したか確認
→ ボットに正しい権限があるか確認

### ❌ Yami機能が動かない
→ `GEMINI_API_KEY` が設定されているか確認
→ `npm run db:init` を実行したか確認

### ❌ Choco機能が動かない
→ `CHOCO_DIR` のパスが正しいか確認
→ フォルダに画像があるか確認

## よく使うコマンド

```bash
# 開発モード起動
npm run dev

# データベース再初期化
npm run db:init

# コマンド再登録
npm run deploy:commands

# ログ確認
# (ログはコンソールに出力されます)
```

## 開発のヒント

### 新機能の追加

1. `src/features/your-feature/` を作成
2. `index.js` を実装
3. 必要に応じて `deploy-commands.js` にコマンド追加
4. ボット再起動

### デバッグ

```bash
# ログレベルをdebugに変更
LOG_LEVEL=debug npm run dev
```

### ホットリロード

開発モードでは `nodemon` が動作し、ファイル変更を検知して自動再起動します。

### テスト用サーバー

開発時は専用のテストサーバーを作ることをおすすめします。

## 次のステップ

- [README.md](./README.md) - 全体概要
- [ARCHITECTURE.md](./ARCHITECTURE.md) - アーキテクチャ詳細
- [Discord.js ドキュメント](https://discord.js.org/) - API詳細
