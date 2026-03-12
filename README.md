# shibainu-bot

Discord Bot for しばいぬサーバー運用。

この README は `src/` と `features.conf` の現在実装に合わせています。

## クイックスタート

```bash
npm install
cp .env.example .env
# .env を編集（DISCORD_TOKEN, CLIENT_ID, GEMINI_API_KEY, CHOCO_DIR など）

node src/deploy-commands.js
node src/index.js
```

PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 logs shibainu-bot
```

## 現在の有効機能（features.conf 既定）

`features.conf`（現状）:

```conf
yami=false
choco=true
health=true
omikuji=true
boost=false
serverstats=false
diaryreaction=true
wiki=true
```

| 機能 | 状態 | 概要 |
|---|---|---|
| Choco | ON | `/choco` とメンションで画像を返信 |
| Health | ON | `/status` で稼働状況を表示 |
| Omikuji | ON | `/omikuji` で運勢表示 |
| DiaryReaction | ON | 対象フォーラムの新規スレッドへ絵文字リアクション |
| Wiki | ON | `/wiki keyword:...` で Wikipedia 要約 |
| Yami | OFF | 現在無効 |
| Boost | OFF | 現在無効 |
| ServerStats | OFF | 現在無効 |

注意:
- `src/core/featureLoader.js` では `yami` / `boost` / `serverstats` は読み込み対象外（他Bot移管扱い）です。

## スラッシュコマンド（deploy-commands.js 準拠）

現在デプロイされるコマンド:

- `/choco`
- `/status`
- `/wiki keyword:<文字列>`
- `/omikuji`

実装ファイル:
- `src/deploy-commands.js`

## Discord 設定

### 必要スコープ

- `bot`
- `applications.commands`

### Privileged Gateway Intents

`src/index.js` で以下を使用:
- `MESSAGE CONTENT INTENT`
- `SERVER MEMBERS INTENT`
- `PRESENCE INTENT`

### 招待リンク（現行有効機能向け）

有効機能（Choco/Health/Omikuji/DiaryReaction/Wiki）に合わせた権限値:
- `permissions=274878024768`

テンプレート:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=274878024768
```

補足:
- `serverstats` を使う場合は `ManageMessages` が追加で必要（`permissions=274878032960`）。

## 主な環境変数

必須:

```env
DISCORD_TOKEN=
CLIENT_ID=
GEMINI_API_KEY=
```

機能別:

```env
# Choco
CHOCO_DIR=./images
CHOCO_REPLY_EPHEMERAL=false

# DiaryReaction
DIARY_FORUM_CHANNEL_ID_TEST=
DIARY_FORUM_CHANNEL_ID_PROD=
```

詳細は `.env.example` を参照。

## 開発

```bash
npm run dev
npm run deploy:commands
npm run features:list
```

## ディレクトリ概要

```text
src/
  index.js                # Bot起動
  deploy-commands.js      # コマンド登録
  core/featureLoader.js   # feature読み込み
  features/
    choco/
    health/
    omikuji/
    diary-reaction/
    wiki/
  commands/
  config/
  db/
  services/
```
