# Welcome機能ガイド

## 概要

Welcome機能は、Discordサーバーの初心者をサポートする2つの機能を提供します。

### 機能1: 初心者歓迎AIリプライ

特定のチャンネルで「はじめまして」「よろしく」を含むメッセージに対して、Gemini AIが生成した歓迎メッセージを自動送信します。

### 機能2: 初心者VC参加通知

アカウント作成から14日未満のユーザーが特定のVCに参加した際、案内部ロールにメンション付きで通知します。

## 設定

### 環境変数

`.env` ファイルに以下を追加してください。

```env
# Gemini API Key（必須）
GEMINI_API_KEY=your_gemini_api_key_here

# データベースパス（オプション、デフォルト: ./data/welcome.sqlite）
WELCOME_DB_PATH=./data/welcome.sqlite
```

### 機能の有効化

`features.conf` で有効化:

```conf
welcome=true
```

### Bot権限（Intents）

以下のIntentsが必要です（自動設定済み）:

- `GuildMembers` - メンバー情報取得
- `GuildVoiceStates` - VC参加検知
- `MessageContent` - メッセージ内容読み取り

### Discord Developer Portal設定

Bot設定で以下を有効化してください:

1. **Privileged Gateway Intents**
   - ✅ Server Members Intent
   - ✅ Message Content Intent

## 機能詳細

### 機能1: 初心者歓迎AIリプライ

#### 対象チャンネル

- チャンネルID: `1464999838130245742`

#### トリガー条件

メッセージに以下のキーワードを含む場合:
- 「はじめまして」
- 「よろしく」

#### 動作

1. キーワードを検出
2. Gemini 2.0 Flash で歓迎メッセージ生成
3. リプライで送信
4. データベースに送信履歴を記録（**1人1回まで**）

#### 例外

テストユーザー（`1107669393049128961`）は**無制限**に反応可能

#### 例

```
ユーザー: はじめまして！よろしくお願いします！
Bot: ようこそ、〇〇さん！🎉
     このサーバーへの参加、ありがとうございます。
     楽しい時間を過ごしてくださいね。
     困ったことがあればいつでも質問してください！
```

### 機能2: 初心者VC参加通知

#### 対象VC（本番サーバー）

以下のVCに参加した場合のみ通知:
- `1452111129332416512`
- `1461288337687183411`
- `1467877616844410901`

#### 通知先（テストサーバー）

- チャンネルID: `1466983702667067475`

#### メンション対象

- 案内部ロールID: `1452478070652141729`

#### 対象ユーザー

アカウント作成から **14日未満** のユーザー

#### 通知内容

```
@案内部 🎤
新しいメンバー @ユーザー名 さんが **VC名** に参加しました！
（アカウント作成から 5 日）
```

## データベース

### テーブル: welcome_history

```sql
CREATE TABLE welcome_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  welcomed_at INTEGER NOT NULL,
  UNIQUE(user_id, guild_id)
);
```

### データ確認

```bash
sqlite3 data/welcome.sqlite

# 歓迎履歴を確認
SELECT * FROM welcome_history;

# 特定ユーザーの履歴削除（テスト用）
DELETE FROM welcome_history WHERE user_id = '1234567890123456789';
```

## トラブルシューティング

### Q: 歓迎メッセージが送信されない

A: 以下を確認してください:

1. **チャンネルID**
   ```
   対象: 1464999838130245742
   ```

2. **キーワード**
   - 「はじめまして」または「よろしく」を含むか

3. **送信履歴**
   ```bash
   sqlite3 data/welcome.sqlite
   SELECT * FROM welcome_history WHERE user_id = 'ユーザーID';
   ```

4. **ログ**
   ```bash
   pm2 logs yamichan-bot | grep welcome
   ```

### Q: VC通知が届かない

A: 以下を確認してください:

1. **対象VC**
   - 参加したVCが以下のいずれかか確認
   - `1452111129332416512`
   - `1461288337687183411`
   - `1467877616844410901`

2. **アカウント年齢**
   - 14日未満のユーザーか確認

3. **通知先チャンネル**
   - テストサーバーの `1466983702667067475` に通知されているか

4. **Bot権限**
   - `GuildVoiceStates` Intent が有効か

5. **ログ**
   ```bash
   pm2 logs yamichan-bot | grep vc_notify
   ```

### Q: Geminiのエラー

A: API Keyを確認:

```bash
echo $GEMINI_API_KEY
```

フォールバックメッセージが送信される場合、APIキーまたはクォータに問題があります。

## カスタマイズ

### 対象チャンネル変更

`src/features/welcome/index.js` の以下を変更:

```javascript
const WELCOME_CHANNEL_ID = '1464999838130245742'; // ← 変更
```

### 対象VC変更

```javascript
const TARGET_VC_IDS = [
  '1452111129332416512',
  '1461288337687183411', 
  '1467877616844410901',
  '新しいVC_ID',  // ← 追加可能
];
```

### 通知先チャンネル変更

```javascript
const NOTIFICATION_CHANNEL_ID = '1466983702667067475'; // ← 変更
```

### メンションロール変更

```javascript
const GUIDE_ROLE_ID = '1452478070652141729'; // ← 変更
```

### アカウント年齢閾値変更

14日 → 30日に変更する場合:

```javascript
const fourteenDays = 30 * 24 * 60 * 60 * 1000; // ← 変更
```

### 歓迎メッセージのトーン変更

`src/features/welcome/geminiService.js` のプロンプトを編集

## デプロイ

### 初回セットアップ

```bash
# 1. 環境変数設定
cp .env.example .env
nano .env  # GEMINI_API_KEY を設定

# 2. 依存関係インストール
npm install

# 3. features.conf 確認
cat features.conf
# welcome=true になっているか確認

# 4. 起動
npm start
```

### PM2での運用

```bash
# 起動
pm2 start ecosystem.config.js

# ログ確認
pm2 logs yamichan-bot | grep welcome

# 再起動
pm2 restart yamichan-bot
```

## ログ出力

### 歓迎メッセージ

```json
{
  "level": "info",
  "event": "welcome.message.trigger",
  "userId": "1234567890123456789",
  "username": "User#1234",
  "guildId": "9876543210987654321",
  "isTestUser": false
}

{
  "level": "info",
  "event": "welcome.message.sent",
  "userId": "1234567890123456789",
  "username": "User",
  "guildId": "9876543210987654321",
  "isTestUser": false,
  "length": 156
}
```

### VC通知

```json
{
  "level": "info",
  "event": "welcome.vc_notify.trigger",
  "userId": "1234567890123456789",
  "username": "User#1234",
  "channelId": "1452111129332416512",
  "channelName": "雑談VC",
  "accountAgeDays": 5
}

{
  "level": "info",
  "event": "welcome.vc_notify.sent",
  "userId": "1234567890123456789",
  "username": "User#1234",
  "channelId": "1452111129332416512",
  "channelName": "雑談VC",
  "accountAgeDays": 5,
  "notifiedTo": "1466983702667067475"
}
```

## 設定サマリー

### ID一覧

| 項目 | ID | 備考 |
|------|-----|------|
| 歓迎チャンネル | `1464999838130245742` | 本番サーバー |
| 対象VC 1 | `1452111129332416512` | 本番サーバー |
| 対象VC 2 | `1461288337687183411` | 本番サーバー |
| 対象VC 3 | `1467877616844410901` | 本番サーバー |
| 通知先チャンネル | `1466983702667067475` | **テストサーバー** |
| 案内部ロール | `1452478070652141729` | 本番サーバー |
| テストユーザー | `1107669393049128961` | 無制限反応 |

### 注意事項

#### 本番環境とテスト環境の混在

- ✅ 歓迎メッセージ: 本番サーバー
- ✅ 対象VC: 本番サーバー
- ⚠️ **通知先: テストサーバー**
- ✅ 案内部ロール: 本番サーバー（テストサーバーには存在しない）

**本番環境で動作させる場合:**

通知先チャンネルIDを本番サーバーのチャンネルに変更してください。

## まとめ

Welcome機能により:

✅ **新規ユーザーを自動で歓迎**
✅ **初心者のVC参加を案内部に通知**
✅ **1人1回制限でスパム防止**
✅ **テストユーザーで動作確認可能**
✅ **Gemini AIで自然な歓迎文**
✅ **14日未満の初心者を自動検知**

が実現できます。
