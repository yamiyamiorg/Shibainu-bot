# Welcome機能 - VC通知機能の一時凍結

## 📋 変更内容

Welcome機能から**VC参加時のロール通知機能**を一時凍結しました。

### 稼働中の機能

✅ **歓迎メッセージ（リプライ機能）**
- 「はじめまして」「よろしく」などのキーワードに自動返信
- サーバー参加から14日以内の新規メンバーが対象
- 引き続き正常に動作します

### 凍結した機能

⏸️ **VC参加通知（ロールメンション機能）**
- 新規メンバーがVCに参加したときのロール通知
- コードはコメントアウトされており、完全に無効化されています

## 🔧 変更したファイル

### src/features/welcome/index.js

```javascript
// VC通知機能の import をコメントアウト
// const { notifyVCJoin } = require('./vcNotifyHandler');

// VoiceStateUpdate イベントリスナー全体をコメントアウト
/*
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // ... VC通知のロジック
});
*/
```

## ✅ 動作確認

### 引き続き動作する機能

```bash
# Bot起動ログを確認
pm2 logs yamichan-bot --lines 30 | grep welcome

# 期待されるログ
welcome.feature.setup {
  messageWelcomeEnabled: true,
  vcNotifyEnabled: false  # ←これが false
}
```

### テスト方法

1. **歓迎メッセージのテスト**
   ```
   # テスト環境の歓迎チャンネルで
   はじめまして！よろしくお願いします
   
   # → Botからリプライが返ってくる ✅
   ```

2. **VC通知が動作しないことの確認**
   ```
   # VCに参加しても通知は来ない ✅
   # ログにも vc_notify 関連のログは出ない ✅
   ```

## 🔄 再開する方法

VC通知機能を再開したい場合の手順:

### 1. ファイルを編集

```bash
vi src/features/welcome/index.js
```

### 2. コメントを解除

```javascript
// 以下の3箇所のコメントを解除

// 1. import文
const { notifyVCJoin } = require('./vcNotifyHandler');

// 2. setup関数内のログ
notificationChannelId: t.notificationChannelId,
guideRoleId: t.guideRoleId,
targetVCCount: t.targetVCIds.length,

// 3. VoiceStateUpdate イベントリスナー全体
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // ... 全体のコメントを解除
});
```

### 3. Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot | grep welcome
```

期待されるログ:
```
welcome.feature.setup {
  vcNotifyEnabled: true  # ←これが true になる
}
```

## 📊 コード比較

### 変更前（VC通知あり）

```javascript
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // VC参加を検知してロールメンション通知
  await notifyVCJoin(newState, t.guideRoleId, t.notificationChannelId);
});
```

### 変更後（VC通知なし）

```javascript
// ★★★ 機能2: 初心者VC参加通知 - 一時凍結 ★★★
/*
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // ... コメントアウト
});
*/
```

## 🚀 デプロイ手順

```bash
# 1. ファイルを配置
cp outputs/welcome-index.js src/features/welcome/index.js

# 2. Bot を再起動
pm2 restart yamichan-bot

# 3. ログで確認
pm2 logs yamichan-bot --lines 30 | grep welcome
```

期待されるログ:
```json
{
  "event": "welcome.feature.setup",
  "messageWelcomeEnabled": true,
  "vcNotifyEnabled": false
}
{
  "event": "welcome.feature.setup.complete",
  "messageWelcomeEnabled": true,
  "vcNotifyEnabled": false
}
```

## ⚠️ 重要な確認事項

### 歓迎メッセージ機能は正常に動作

- ✅ リプライ機能は引き続き稼働
- ✅ 14日以内の新規メンバーに反応
- ✅ テストユーザーの設定も有効

### VC通知機能は完全に停止

- ✅ VoiceStateUpdate イベントリスナーがコメントアウトされている
- ✅ notifyVCJoin 関数は呼ばれない
- ✅ ロールメンションは送信されない

### 稼働環境への影響

- ✅ コードはコメントアウトなので、削除されていない
- ✅ いつでも再開可能
- ✅ 他の機能に影響なし
- ✅ Bot がクラッシュすることはない

## 📝 変更理由（想定）

VC通知機能を一時凍結した理由の候補:

1. ロールメンションの頻度を調整したい
2. 通知方法を見直したい
3. 機能の効果を検証したい
4. 一時的にメンション通知を停止したい

## 🔍 ログでの確認方法

### 歓迎メッセージが動作しているか

```bash
pm2 logs yamichan-bot | grep "welcome.message"
```

期待されるログ:
```
welcome.message.trigger
welcome.reply.sent
```

### VC通知が停止しているか

```bash
pm2 logs yamichan-bot | grep "welcome.vc_notify"
```

期待される結果:
```
（何も出力されない = 正しく停止している）
```

## ✅ チェックリスト

デプロイ後に確認:

- [ ] Bot が正常に起動している
- [ ] 起動ログに `vcNotifyEnabled: false` が表示される
- [ ] 歓迎メッセージ（リプライ）が正常に動作する
- [ ] VCに参加しても通知が来ない
- [ ] ログに `vc_notify` 関連のログが出ない

---

**変更日:** 2026年2月17日
**変更者:** -
**理由:** ロール通知機能の一時停止要望
