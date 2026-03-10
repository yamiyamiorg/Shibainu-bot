# Boost機能 - デバッグ対応完了

## 🐛 問題の分析

`!testboost` コマンドが動作しない問題について、以下の改善を実施しました。

## ✅ 実装した改善

### 1. 大幅なデバッグログ追加

**追加したログポイント:**

- **起動時:**
  - `boost.feature.setup` - 設定情報
  - `boost.test_user.registered` - 各テストユーザーID（型情報付き）
  - `boost.feature.setup.complete` - セットアップ完了確認

- **メッセージ受信時:**
  - `boost.message_received` - コマンド候補のメッセージを記録
  - `boost.command_candidate` - `!`で始まるコマンドをすべて記録
  - `boost.not_test_user` - テストユーザーでない場合の詳細
  - `boost.command_not_match` - コマンドが一致しない場合

- **ブーストイベント時:**
  - `boost.test_event.triggered` - テストコマンド成功
  - `boost.test_message.deleted` - メッセージ削除成功
  - `boost.test_event.delete_failed` - メッセージ削除失敗（権限不足など）

- **メッセージ送信時:**
  - `boost.send_message.start` - 送信開始
  - `boost.send_message.channel_ok` - チャンネル取得成功
  - `boost.send_message.sending` - 送信実行
  - `boost.send_message.success` - 送信成功
  - `boost.send_message.channel_not_found` - チャンネル未発見
  - `boost.send_message.invalid_channel_type` - チャンネル型が不正
  - `boost.send_message.missing_access` - チャンネルアクセス権限なし（Error 50001）
  - `boost.send_message.missing_permissions` - メッセージ送信権限なし（Error 50013）

### 2. 堅牢なエラーハンドリング

**改善点:**

- `message.member` が null の場合に自動で `fetch` を試行
- チャンネル取得の段階的な検証
- Discord APIエラーコードの詳細ログ
- 各ステップでの null チェック強化

### 3. より厳密なテストユーザーID照合

```javascript
// 変更前（問題あり）
if (!t.testUserIds.includes(userId)) return;

// 変更後（堅牢）
const isTestUser = t.testUserIds.some(testId => String(testId) === userId);
if (!isTestUser) return;
```

**理由:** 
- `includes()` は型が異なると失敗する可能性がある
- `String()` で明示的に変換して比較

### 4. 診断スクリプトの追加

**ファイル:** `scripts/diagnose-boost.js`

**機能:**
- テストユーザーIDが正しく登録されているか確認
- 型の不一致を検出
- 設定内容の可視化

**使い方:**
```bash
node scripts/diagnose-boost.js YOUR_USER_ID
```

## 📋 更新ファイル

```
boost/index.js              # メイン機能（大幅改善）
scripts/diagnose-boost.js   # 診断ツール（新規）
BOOST_DEBUG_GUIDE.md        # デバッグガイド（新規）
```

## 🚀 トラブルシューティング手順

### ステップ1: 診断スクリプトを実行

```bash
node scripts/diagnose-boost.js YOUR_USER_ID
```

**ユーザーIDの取得:**
1. Discord 開発者モードを有効化
2. 自分のアイコン右クリック → IDをコピー

### ステップ2: Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot
```

### ステップ3: 起動ログを確認

期待されるログ:
```
boost.feature.setup {
  envTarget: 'test',
  boostChannelId: '1473078389442351277',
  testUserIds: ['902878433799979078', '1107669393049128961'],
  testUserCount: 2
}

boost.test_user.registered { index: 0, userId: '902878433799979078', userIdType: 'string' }
boost.test_user.registered { index: 1, userId: '1107669393049128961', userIdType: 'string' }
boost.feature.setup.complete { ... }
```

### ステップ4: コマンドをテスト

Discordで:
```
!testboost
```

### ステップ5: ログを確認

```bash
pm2 logs yamichan-bot --lines 0
```

**成功時のログ:**
```
boost.message_received
boost.command_candidate
boost.test_event.triggered
boost.send_message.success
```

**失敗時のログ:**
- `boost.not_test_user` → テストユーザーIDが登録されていない
- `boost.command_not_match` → コマンドが間違っている（空白など）
- `boost.send_message.channel_not_found` → チャンネルIDが間違っている
- `boost.send_message.missing_permissions` → Bot権限不足

## 🔍 よくある問題

### 問題1: ログに何も出ない

**原因:** 機能が無効、またはBotが起動していない

**解決:**
```bash
cat features.conf | grep boost  # → boost=true:test を確認
pm2 status yamichan-bot         # → online を確認
```

### 問題2: `boost.not_test_user` が出る

**原因:** ユーザーIDが testUserIds に含まれていない

**解決:**
```javascript
// src/config/boostTarget.js
testUserIds: ['YOUR_USER_ID', ...],
```

### 問題3: `boost.command_not_match` が出る

**原因:** コマンドの前後に空白がある

**解決:** 厳密に `!testboost` または `!boost` を送信

### 問題4: チャンネルにメッセージが送信されない

**原因:** Bot権限不足またはチャンネルID間違い

**解決:**
1. チャンネルIDを確認
2. Bot に View Channels と Send Messages 権限を付与

## 📊 デバッグログの見方

### 正常な流れ

```
1. boost.feature.setup → 機能起動
2. boost.test_user.registered → テストユーザー登録
3. boost.message_received → メッセージ受信
4. boost.command_candidate → コマンド候補検出
5. boost.test_event.triggered → テストコマンド実行
6. boost.send_message.success → メッセージ送信成功
```

### 異常時の診断

| ログが途切れる場所 | 原因 |
|-------------------|------|
| 1の後 | 機能が無効化されている |
| 3の前 | メッセージが送信されていない |
| 4の前 | コマンドが`!`で始まっていない |
| 5の前 | テストユーザーIDが一致していない |
| 6の前 | チャンネルまたは権限の問題 |

## ✅ インストール・更新手順

```bash
# 1. ファイルを配置
cp outputs/boost/index.js src/features/boost/
cp outputs/diagnose-boost.js scripts/

# 2. 実行権限を付与（必要に応じて）
chmod +x scripts/diagnose-boost.js

# 3. 診断を実行
node scripts/diagnose-boost.js YOUR_USER_ID

# 4. Bot を再起動
pm2 restart yamichan-bot

# 5. ログを監視
pm2 logs yamichan-bot --lines 0

# 6. Discordでテスト
# → !testboost
```

## 🎯 期待される結果

### 診断スクリプト実行時

```
✅ このユーザーIDは正しく登録されています！

📝 テストコマンド:
Discordで以下のコマンドを送信してください:
  !testboost
または
  !boost

期待される動作:
1. コマンドメッセージが削除される
2. チャンネル 1473078389442351277 にブースト感謝メッセージが送信される
```

### コマンド実行時

1. Discordで `!testboost` を送信
2. コマンドメッセージが削除される
3. 設定されたチャンネルに以下のメッセージが送信される:

```
[あなたの表示名]さん、ブーストありがとう！ めっちゃ助かる！音質・高画質配信が向上して、みんなでさらに楽しめそうです！これからもコミュニティを一緒に盛り上げていこうねー！
```

## 📚 関連ドキュメント

- `BOOST_DEBUG_GUIDE.md` - 詳細なデバッグガイド
- `BOOST_FEATURE.md` - 機能仕様書
- `BOOST_TEST_GUIDE.md` - テスト手順

## 🎉 まとめ

Boost機能を大幅に堅牢化しました：

✅ 詳細なデバッグログ（20以上のログポイント）
✅ 診断スクリプト追加
✅ エラーハンドリング強化
✅ 型安全な比較
✅ Discord APIエラーコードの詳細ログ
✅ 段階的な検証

問題が発生した場合は、まず診断スクリプトを実行し、ログを確認してください。
