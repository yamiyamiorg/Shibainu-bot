# サーバーブースト通知機能 - 実装完了

## 📋 実装概要

サーバーブーストを検知して感謝メッセージを自動送信する機能を実装しました。

### ✅ 実装した機能

1. **本番ブースト検知**
   - Discord の `GuildMemberUpdate` イベントで実際のサーバーブーストを検知
   - ブーストされた瞬間に指定チャンネルへ自動送信

2. **テスト用疑似ブースト**
   - テストユーザー（`902878433799979078`, `1107669393049128961`）専用
   - `!testboost` または `!boost` コマンドで疑似的にブーストイベントを発生
   - 実際のブーストなしで動作確認可能

3. **環境別設定**
   - テスト環境: チャンネルID `1473078389442351277`
   - 本番環境: チャンネルID `1452263017348857896` (😛雑談掲示板😉)
   - `features.conf` で簡単に切り替え可能

### 📁 実装ファイル

```
src/
├── features/
│   └── boost/
│       └── index.js              # メイン機能（イベントハンドラ）
├── config/
│   └── boostTarget.js            # 環境別設定（test/prod）
└── [既存ファイル]
    └── utils/featureConfig.js    # 設定読み込み（変更なし）

features.conf                     # 機能ON/OFF設定（boost設定追加）

ドキュメント:
├── BOOST_FEATURE.md              # 詳細仕様書
├── BOOST_TEST_GUIDE.md           # テスト手順
└── BOOST_QUICKSTART.md           # 5分でセットアップ
```

## 🚀 インストール手順

### ステップ1: ファイルを配置

```bash
# boost機能ディレクトリを作成
mkdir -p src/features/boost

# ファイルをコピー
cp outputs/boost/index.js src/features/boost/
cp outputs/boostTarget.js src/config/
cp outputs/features.conf ./
```

### ステップ2: 設定を確認

`features.conf` に以下が追加されていることを確認:

```conf
# Boost機能（サーバーブースト通知）
boost=true:test
```

### ステップ3: Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 30
```

ログに以下が表示されればOK:
```
boost.feature.setup {
  envTarget: 'test',
  boostChannelId: '1473078389442351277',
  testUserIds: [ '902878433799979078', '1107669393049128961' ]
}
```

### ステップ4: テスト実行

テストユーザーで Discord にログイン → 任意のチャンネルで:

```
!testboost
```

チャンネルID `1473078389442351277` に感謝メッセージが送信されることを確認。

## 🎯 本番環境への移行

### 1. features.conf を編集

```bash
vi features.conf
```

```diff
- boost=true:test
+ boost=true:prod
```

### 2. Bot を再起動

```bash
pm2 restart yamichan-bot
```

### 3. 動作確認

- テストコマンドで本番チャンネル（😛雑談掲示板😉）への送信を確認
- 実際のサーバーブーストを待つ

## 🛡️ 堅牢性の特徴

### 1. 多重エラーハンドリング
- すべてのイベントハンドラに try-catch
- 個別のエラーを詳細ログに記録
- 一部の失敗（メッセージ削除失敗など）は無視して継続

### 2. フェイルセーフ設計
- チャンネル取得失敗時は静かに失敗（サービス停止なし）
- 不正なユーザーからのコマンドは無視
- Bot メッセージや DM は早期リターンで除外

### 3. 詳細ログ
すべての重要イベントを記録:
- `boost.feature.setup` - 起動時
- `boost.real_event.detected` - 実ブースト検知
- `boost.test_event.triggered` - テストコマンド実行
- `boost.send_message.success` - 送信成功
- `boost.send_message.error` - 送信失敗

### 4. テスト容易性
- 疑似ブーストコマンドで何度でもテスト可能
- テストユーザーIDは制限されているため誤爆なし
- コマンドメッセージは自動削除

## 📝 送信されるメッセージ

```
[ユーザー名]さん、ブーストありがとう！ めっちゃ助かる！音質・高画質配信が向上して、みんなでさらに楽しめそうです！これからもコミュニティを一緒に盛り上げていこうねー！
```

※ユーザー名は Discord の表示名（displayName）が使用されます

## 🔧 カスタマイズ

### チャンネルIDを変更

`src/config/boostTarget.js` を編集:

```javascript
const TEST = {
    boostChannelId: 'あなたのテストチャンネルID',
    testUserIds: ['902878433799979078', '1107669393049128961'],
};

const PROD = {
    boostChannelId: 'あなたの本番チャンネルID',
    testUserIds: ['902878433799979078', '1107669393049128961'],
};
```

### メッセージ内容を変更

`src/features/boost/index.js` の `sendBoostMessage` 関数内:

```javascript
const message = `カスタムメッセージをここに書く`;
```

### テストユーザーを追加

`src/config/boostTarget.js`:

```javascript
testUserIds: ['902878433799979078', '1107669393049128961', '新しいユーザーID'],
```

## 🐛 トラブルシューティング

### メッセージが送信されない

1. ログ確認
   ```bash
   pm2 logs yamichan-bot --lines 50 | grep boost
   ```

2. チャンネルID確認
   - Discord 開発者モード有効化
   - チャンネル右クリック → IDをコピー
   - `boostTarget.js` と一致するか確認

3. Bot権限確認
   - View Channels ✅
   - Send Messages ✅

### テストコマンドが動かない

1. ユーザーID確認
   - Discord でユーザー右クリック → IDをコピー
   - `boostTarget.js` の `testUserIds` に含まれているか確認

2. コマンド確認
   - 正確に `!testboost` または `!boost`
   - 前後に空白なし

### 本番ブーストが検知されない

1. Bot がサーバーメンバー更新を受信できているか確認
2. ログで `GuildMemberUpdate` イベントが発火しているか確認
3. Bot の権限（特にメンバー情報の閲覧権限）を確認

## 📚 ドキュメント

- **BOOST_FEATURE.md** - 詳細な機能仕様とアーキテクチャ
- **BOOST_TEST_GUIDE.md** - 包括的なテスト手順とトラブルシューティング
- **BOOST_QUICKSTART.md** - 5分でセットアップするクイックガイド

## ✅ チェックリスト

デプロイ前に確認:

- [ ] すべてのファイルが正しい場所に配置されている
- [ ] `features.conf` で boost 機能が有効化されている
- [ ] Bot が必要な権限を持っている
- [ ] テスト環境で動作確認済み
- [ ] ログで正常起動を確認
- [ ] テストコマンドで疎通確認済み

本番移行前に確認:

- [ ] `features.conf` を `boost=true:prod` に変更
- [ ] 本番チャンネルIDが正しい
- [ ] テストコマンドで本番チャンネルへの送信を確認
- [ ] ログ監視体制を整えている

## 🎉 完了！

サーバーブースト通知機能の実装が完了しました。

質問や問題があれば、ログファイルとドキュメントを確認してください。
