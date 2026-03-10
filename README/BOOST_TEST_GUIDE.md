# ブースト機能テストガイド

## 前提条件

- Bot がサーバーに参加している
- Bot に以下の権限がある
  - View Channels
  - Send Messages
  - Manage Messages（テストコマンド削除用）
- テストユーザーID: `902878433799979078` または `1107669393049128961`

## テスト手順

### ステップ1: 環境設定確認

```bash
# features.conf を確認
cat features.conf | grep boost

# 期待される出力:
# boost=true:test
```

### ステップ2: Bot を起動

```bash
# 開発環境
npm start

# または本番環境（PM2）
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 50
```

### ステップ3: 起動ログ確認

ログに以下のような出力があることを確認：

```
boost.feature.setup {
  envTarget: 'test',
  boostChannelId: '1473078389442351277',
  testUserIds: [ '902878433799979078', '1107669393049128961' ]
}
```

### ステップ4: テストブーストコマンド実行

テストユーザーで Discord にログイン → 任意のチャンネルで：

```
!testboost
```

または

```
!boost
```

### ステップ5: 結果確認

1. **コマンドメッセージが削除される**（Bot に権限がある場合）
2. **設定されたチャンネルに感謝メッセージが送信される**
   - テスト環境: チャンネルID `1473078389442351277`
   - 本番環境: チャンネルID `1452263017348857896`

期待されるメッセージ:
```
[ユーザー名]さん、ブーストありがとう！ めっちゃ助かる！音質・高画質配信が向上して、みんなでさらに楽しめそうです！これからもコミュニティを一緒に盛り上げていこうねー！
```

### ステップ6: ログ確認

```bash
pm2 logs yamichan-bot --lines 20
```

期待されるログ:
```
boost.test_event.triggered {
  userId: '902878433799979078',
  username: 'TestUser#1234',
  displayName: 'テストユーザー',
  channelId: '...',
  envTarget: 'test'
}

boost.send_message.success {
  userId: '902878433799979078',
  username: 'TestUser#1234',
  displayName: 'テストユーザー',
  channelId: '1473078389442351277',
  messageLength: 123
}
```

## テストケース一覧

### ✅ テストケース1: 正常系（テストブーストコマンド）
- **条件**: テストユーザーが `!testboost` を送信
- **期待結果**: 
  - コマンドメッセージ削除
  - 設定チャンネルに感謝メッセージ送信
  - ログに `boost.test_event.triggered` と `boost.send_message.success`

### ✅ テストケース2: 別のコマンド形式
- **条件**: テストユーザーが `!boost` を送信
- **期待結果**: テストケース1と同じ

### ❌ テストケース3: 非テストユーザー
- **条件**: 一般ユーザーが `!testboost` を送信
- **期待結果**: 
  - メッセージは削除されない
  - 感謝メッセージは送信されない
  - ログに何も記録されない

### ❌ テストケース4: 無効なコマンド
- **条件**: テストユーザーが `!testboost2` や `testboost` を送信
- **期待結果**: 
  - 何も起こらない
  - ログに何も記録されない

### ✅ テストケース5: 本番ブーストイベント（実際のブースト必要）
- **条件**: 誰かが実際にサーバーブーストを開始
- **期待結果**: 
  - 設定チャンネルに感謝メッセージ送信
  - ログに `boost.real_event.detected` と `boost.send_message.success`

## トラブルシューティング

### 問題1: コマンドを送信してもメッセージが送信されない

**確認項目**:
1. ユーザーIDが正しいか確認
   ```bash
   # Discord開発者モード有効化 → ユーザー右クリック → IDをコピー
   # boostTarget.js の testUserIds と一致するか確認
   ```

2. ログを確認
   ```bash
   pm2 logs yamichan-bot --lines 50
   ```

3. features.conf で機能が有効か確認
   ```bash
   cat features.conf | grep boost
   # boost=true:test が必要
   ```

### 問題2: コマンドメッセージが削除されない

**原因**: Bot に Manage Messages 権限がない

**対処**:
- サーバー設定 → 役割 → Bot の役割 → 権限 → "メッセージを管理" を有効化
- または、この動作は問題ない（削除は必須ではない）

### 問題3: ログに boost.feature.setup が表示されない

**原因**: 機能が読み込まれていない

**対処**:
1. featureLoader.js が boost 機能を読み込んでいるか確認
2. Bot を再起動
   ```bash
   pm2 restart yamichan-bot
   ```

## 本番環境への移行

### ステップ1: features.conf を編集

```bash
vi features.conf
```

変更:
```diff
- boost=true:test
+ boost=true:prod
```

### ステップ2: Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 20
```

### ステップ3: ログで本番環境確認

```
boost.feature.setup {
  envTarget: 'prod',
  boostChannelId: '1452263017348857896',
  testUserIds: [ '902878433799979078', '1107669393049128961' ]
}
```

### ステップ4: テストコマンドで確認（オプション）

本番環境でもテストユーザーは疑似ブーストコマンドを使用可能。
本番チャンネル（😛雑談掲示板😉）にメッセージが送信されることを確認。

```
!testboost
```

### ステップ5: 実際のブーストを待つ

実際にユーザーがサーバーブーストしたときに、本番チャンネルに自動で感謝メッセージが送信されることを確認。

## 継続的な監視

```bash
# リアルタイムログ監視
pm2 logs yamichan-bot --lines 100 --raw

# boost関連のログのみフィルタ
pm2 logs yamichan-bot --lines 100 | grep boost
```

## まとめ

- ✅ テスト環境で十分にテストしてから本番に移行
- ✅ ログを定期的に確認して問題がないか監視
- ✅ テストユーザーIDは本番でも有効（緊急時の動作確認用）
- ✅ 実際のブーストイベントは `GuildMemberUpdate` で自動検知される
