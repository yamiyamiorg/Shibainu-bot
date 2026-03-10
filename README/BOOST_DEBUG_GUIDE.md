# Boost機能 - デバッグ＆トラブルシューティングガイド

## 🐛 問題: !testboost コマンドが動かない

### ステップ1: 診断スクリプトを実行

```bash
node scripts/diagnose-boost.js YOUR_USER_ID
```

**ユーザーIDの取得方法:**
1. Discord 開発者モードを有効化
   - ユーザー設定 → アプリの設定 → 詳細設定 → 開発者モード ON
2. 自分のアイコンを右クリック → 「IDをコピー」

**例:**
```bash
node scripts/diagnose-boost.js 902878433799979078
```

### ステップ2: ログを確認

```bash
# リアルタイムログ監視
pm2 logs yamichan-bot

# Boost関連のログのみ表示
pm2 logs yamichan-bot --lines 100 | grep boost
```

### ステップ3: 期待されるログの流れ

#### 起動時:
```
boost.feature.setup {
  envTarget: 'test',
  boostChannelId: '1473078389442351277',
  testUserIds: ['902878433799979078', '1107669393049128961'],
  testUserCount: 2
}

boost.test_user.registered {
  index: 0,
  userId: '902878433799979078',
  userIdType: 'string'
}

boost.test_user.registered {
  index: 1,
  userId: '1107669393049128961',
  userIdType: 'string'
}

boost.feature.setup.complete {
  realEventListenerRegistered: true,
  testEventListenerRegistered: true
}
```

#### コマンド送信時（成功）:
```
boost.message_received {
  content: '!testboost',
  authorId: '902878433799979078',
  isBot: false,
  hasGuild: true
}

boost.command_candidate {
  content: '!testboost',
  userId: '902878433799979078',
  isTestUser: true
}

boost.test_event.triggered {
  userId: '902878433799979078',
  username: 'YourName#1234',
  displayName: 'YourDisplayName',
  channelId: '...',
  content: '!testboost',
  envTarget: 'test'
}

boost.test_message.deleted { messageId: '...' }

boost.send_message.start {
  userId: '902878433799979078',
  channelId: '1473078389442351277',
  env: 'test'
}

boost.send_message.channel_ok {
  channelId: '1473078389442351277',
  channelName: 'テストチャンネル',
  channelType: 0
}

boost.send_message.sending {
  channelId: '1473078389442351277',
  messageLength: 123,
  displayName: 'YourDisplayName'
}

boost.send_message.success {
  userId: '902878433799979078',
  username: 'YourName#1234',
  displayName: 'YourDisplayName',
  channelId: '1473078389442351277',
  channelName: 'テストチャンネル',
  messageLength: 123,
  env: 'test'
}
```

#### コマンド送信時（失敗 - テストユーザーでない）:
```
boost.message_received {
  content: '!testboost',
  authorId: '111111111111111111',
  isBot: false,
  hasGuild: true
}

boost.command_candidate {
  content: '!testboost',
  userId: '111111111111111111',
  isTestUser: false
}

boost.not_test_user {
  userId: '111111111111111111',
  content: '!testboost',
  testUserIds: ['902878433799979078', '1107669393049128961']
}
```

## 🔍 よくある問題と解決方法

### 問題1: ログに何も出ない

**原因:** 機能が有効化されていない、またはBotが起動していない

**確認:**
```bash
# features.conf を確認
cat features.conf | grep boost
# → boost=true:test が必要

# Bot の状態を確認
pm2 status yamichan-bot
```

**解決:**
```bash
# features.conf を編集
vi features.conf
# boost=true:test を設定

# Bot を再起動
pm2 restart yamichan-bot
```

### 問題2: `boost.not_test_user` が出る

**原因:** ユーザーIDがテストユーザーとして登録されていない

**確認:**
```bash
node scripts/diagnose-boost.js YOUR_USER_ID
```

**解決:**
```javascript
// src/config/boostTarget.js を編集
const TEST = {
    boostChannelId: '1473078389442351277',
    testUserIds: [
        '902878433799979078',
        '1107669393049128961',
        'YOUR_USER_ID', // ← ここに追加
    ],
};
```

```bash
pm2 restart yamichan-bot
```

### 問題3: `boost.command_not_match` が出る

**原因:** コマンドの前後に空白や余分な文字がある

**確認:**
```
boost.command_not_match {
  content: ' !testboost',  // ← 前に空白がある
  expected: ['!testboost', '!boost']
}
```

**解決:**
厳密に以下のいずれかを送信してください（前後に空白なし）:
- `!testboost`
- `!boost`

### 問題4: `boost.send_message.channel_not_found` が出る

**原因:** チャンネルIDが間違っている、またはBotがチャンネルにアクセスできない

**確認:**
```bash
# boostTarget.js のチャンネルIDを確認
cat src/config/boostTarget.js | grep boostChannelId
```

**解決:**
1. チャンネルIDが正しいか確認
   - Discord でチャンネル右クリック → IDをコピー
2. Botがチャンネルを見られるか確認
   - チャンネルの権限設定でBotロールに View Channels を付与

### 問題5: `boost.send_message.missing_permissions` (Error 50013)

**原因:** Botに Send Messages 権限がない

**解決:**
1. サーバー設定 → 役割 → Botの役割
2. 「メッセージを送信」を有効化
3. または、チャンネル固有の権限を確認

### 問題6: `boost.message.no_member` が出る

**原因:** `message.member` が null（DMやキャッシュの問題）

**解決:**
コードで自動的に `fetch` を試みるようになっているため、通常は自動解決されます。
それでも失敗する場合はログを確認:
```
boost.message.fetch_member_failed
```

### 問題7: メッセージが削除されない

**原因:** Botに Manage Messages 権限がない

**ログ:**
```
boost.test_event.delete_failed {
  err: 'Missing Permissions',
  code: 50013
}
```

**解決:**
- メッセージ削除は必須ではないため、無視してOK
- 削除したい場合は、Botに Manage Messages 権限を付与

## 🧪 手動テスト手順

### 完全なテストフロー

1. **診断スクリプトを実行**
   ```bash
   node scripts/diagnose-boost.js YOUR_USER_ID
   ```
   → ✅ が表示されることを確認

2. **Bot を再起動**
   ```bash
   pm2 restart yamichan-bot
   pm2 logs yamichan-bot
   ```

3. **起動ログを確認**
   - `boost.feature.setup` が表示される
   - `boost.test_user.registered` で自分のIDが表示される

4. **Discordでコマンド送信**
   ```
   !testboost
   ```

5. **ログをリアルタイムで確認**
   ```bash
   pm2 logs yamichan-bot --lines 0
   ```
   
   期待されるログ:
   - `boost.message_received`
   - `boost.command_candidate`
   - `boost.test_event.triggered`
   - `boost.send_message.success`

6. **結果確認**
   - コマンドメッセージが削除される
   - 設定されたチャンネルにブースト感謝メッセージが送信される

## 🔧 デバッグモードの有効化

より詳細なログを見たい場合:

```bash
# ログレベルを debug に変更（logger設定による）
# または、コード内の logger.debug を logger.info に変更
```

## 📊 ログレベルの説明

- `logger.debug`: デバッグ情報（通常は非表示）
- `logger.info`: 通常の情報ログ
- `logger.warn`: 警告（動作は継続）
- `logger.error`: エラー（機能が失敗）

## ✅ 正常動作のチェックリスト

- [ ] `node scripts/diagnose-boost.js YOUR_USER_ID` で ✅ が表示される
- [ ] `features.conf` で `boost=true:test` が設定されている
- [ ] Bot が起動している（`pm2 status`）
- [ ] 起動ログに `boost.feature.setup.complete` が表示される
- [ ] テストコマンド送信時に `boost.test_event.triggered` が表示される
- [ ] `boost.send_message.success` が表示される
- [ ] Discordでブースト感謝メッセージが表示される

## 🚨 緊急時のデバッグ

すべてが失敗する場合、以下を確認:

```bash
# 1. Bot がログインしているか
pm2 logs yamichan-bot | grep "bot.ready"

# 2. MessageCreate イベントが機能しているか
# 任意のチャンネルで何かメッセージを送信
# → 他の機能（Yamiなど）が反応するか確認

# 3. features.conf が正しく読み込まれているか
pm2 logs yamichan-bot | grep "featureConfig.loaded"

# 4. Boost機能が有効化されているか
pm2 logs yamichan-bot | grep "boost.feature"
```

## 📞 サポート

それでも解決しない場合:

1. ログ全体を確認
   ```bash
   pm2 logs yamichan-bot --lines 200 > boost_debug.log
   ```

2. `boost_debug.log` を確認し、エラーメッセージを特定

3. このガイドの該当セクションを再確認
