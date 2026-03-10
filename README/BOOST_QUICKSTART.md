# Boost機能 - クイックスタート

## 5分でセットアップ

### 1. 機能を有効化

```bash
vi features.conf
```

以下の行を追加または編集:
```conf
boost=true:test
```

### 2. Bot を再起動

```bash
pm2 restart yamichan-bot
```

### 3. ログで確認

```bash
pm2 logs yamichan-bot --lines 20
```

以下のログが表示されればOK:
```
boost.feature.setup {
  envTarget: 'test',
  boostChannelId: '1473078389442351277',
  testUserIds: [ '902878433799979078', '1107669393049128961' ]
}
```

### 4. テスト実行

テストユーザー（`902878433799979078` または `1107669393049128961`）で任意のチャンネルに：

```
!testboost
```

### 5. 結果確認

チャンネルID `1473078389442351277` に以下のメッセージが送信される:

```
[あなたのユーザー名]さん、ブーストありがとう！ めっちゃ助かる！音質・高画質配信が向上して、みんなでさらに楽しめそうです！これからもコミュニティを一緒に盛り上げていこうねー！
```

## 本番環境への切り替え

```bash
vi features.conf
```

```diff
- boost=true:test
+ boost=true:prod
```

```bash
pm2 restart yamichan-bot
```

本番チャンネル（😛雑談掲示板😉, ID: `1452263017348857896`）にメッセージが送信されるようになります。

## トラブル？

詳細は `BOOST_TEST_GUIDE.md` を参照してください。
