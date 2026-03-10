# Nukumori機能 - 環境切り替え対応（更新版）

## 🔄 更新内容

Nukumori機能に**テスト環境/本番環境の切り替え**機能を追加しました。
WelcomeやBoostと同じパターンで、`features.conf`で簡単に切り替えられます。

## 📋 変更点

### 1. features.conf の形式変更

**変更前:**
```conf
nukumori=true
```

**変更後:**
```conf
nukumori=true:test   # テスト環境
# nukumori=true:prod # 本番環境
```

### 2. チャンネルIDの修正

**テスト環境:**
- 対象チャンネル:
  - `1466983702667067475`（テスト環境の雑談）
  - `1473088856000692409`（😛テスト😉）
- 月次レポート送信先: `1473088856000692409`（😛テスト😉）

**本番環境:**
- 対象チャンネル:
  - `1452263017348857896`（😛雑談掲示板😉）
  - `1451873523047071808`（🥺今日の報告）
  - `1462387547350106145`（📜懺悔の部屋）
  - `1471831121351147532`（🏥匿名SOSチャット）
- 月次レポート送信先: `1452263017348857896`（😛雑談掲示板😉）

### 3. 設定ファイルの構造

`src/config/nukumoriTarget.js` が Welcome/Boost と同じパターンになりました：

```javascript
const TEST = {
    targetChannels: [...],
    targetEmojis: [...],
    reportChannelId: '1473088856000692409',
};

const PROD = {
    targetChannels: [...],
    targetEmojis: [...],
    reportChannelId: '1452263017348857896',
};

const env = getEnvTarget(); // features.confから読み取り
const base = env === 'prod' ? PROD : TEST;
```

## 🚀 使い方

### テスト環境で動作確認

```bash
vi features.conf
```

```conf
nukumori=true:test
```

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 20
```

ログで確認:
```
nukumori.feature.setup {
  envTarget: 'test',
  targetChannels: ['1466983702667067475', '1473088856000692409'],
  targetEmojis: ['❤️', '💚', '🫶', '🤝', '🌱', '🪽'],
  reportChannelId: '1473088856000692409'
}
```

### 本番環境に切り替え

```bash
vi features.conf
```

```diff
- nukumori=true:test
+ nukumori=true:prod
```

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 20
```

ログで確認:
```
nukumori.feature.setup {
  envTarget: 'prod',
  targetChannels: [
    '1452263017348857896',
    '1451873523047071808',
    '1462387547350106145',
    '1471831121351147532'
  ],
  targetEmojis: ['❤️', '💚', '🫶', '🤝', '🌱', '🪽'],
  reportChannelId: '1452263017348857896'
}
```

## 🧪 テスト手順

### ステップ1: テスト環境で確認

1. `features.conf` で `nukumori=true:test` を設定
2. Bot を再起動
3. テストチャンネル（`1473088856000692409`）で投稿
4. ❤️ などの対象絵文字でリアクション
5. ログで `nukumori.reaction.recorded` を確認
6. `/nukumori` コマンドで統計表示を確認

### ステップ2: 月次レポート送信先を確認

テスト環境では `1473088856000692409`（😛テスト😉）に送信されます。

### ステップ3: 本番環境に移行

1. テストで動作確認完了
2. `features.conf` で `nukumori=true:prod` に変更
3. Bot を再起動
4. ログで本番チャンネルIDを確認

## ⚙️ 環境変数での上書き（オプション）

`.env` ファイルで個別に上書き可能:

```bash
# 対象チャンネルを上書き
NUKUMORI_TARGET_CHANNELS=1234567890,0987654321

# 対象絵文字を上書き
NUKUMORI_TARGET_EMOJIS=❤️,💚,👍

# 月次レポート送信先を上書き
NUKUMORI_REPORT_CHANNEL_ID=1234567890
```

## 📊 環境別の違い

| 項目 | テスト環境 | 本番環境 |
|------|-----------|---------|
| 対象チャンネル数 | 2個 | 4個 |
| 月次レポート送信先 | 😛テスト😉 | 😛雑談掲示板😉 |
| 対象絵文字 | 共通（❤️💚🫶🤝🌱🪽） | 共通（❤️💚🫶🤝🌱🪽） |

## 🔄 既存データの扱い

データベース（`data/nukumori.sqlite`）は**環境間で共有**されます。

- テスト環境で記録したリアクション
- 本番環境で記録したリアクション

両方とも同じデータベースに保存されます。

**統計表示時は channel_id で区別されません**が、実際のリアクションは対象チャンネルでのみ記録されるため問題ありません。

環境を完全に分離したい場合:
```bash
# テスト環境用の別DBを使う
mv data/nukumori.sqlite data/nukumori_test.sqlite

# 本番環境に切り替え時
mv data/nukumori_test.sqlite data/nukumori_test.backup.sqlite
# 新しいnukumori.sqliteが自動作成される
```

## ✅ 更新チェックリスト

- [ ] `src/config/nukumoriTarget.js` を更新版に置き換え
- [ ] `src/features/nukumori/index.js` を更新版に置き換え
- [ ] `features.conf` を更新版に置き換え
- [ ] `nukumori=true:test` が設定されていることを確認
- [ ] Bot を再起動
- [ ] ログで `envTarget: 'test'` を確認
- [ ] テストチャンネルで動作確認
- [ ] `/nukumori` コマンドで統計表示を確認

## 📚 関連ドキュメント

- `NUKUMORI_FEATURE.md` - 詳細仕様書
- `NUKUMORI_QUICKSTART.md` - クイックスタート
- `NUKUMORI_IMPLEMENTATION.md` - 実装サマリー

## 🎉 完了！

Nukumori機能がテスト/本番環境切り替えに対応しました。

テスト環境で十分に動作確認してから、本番環境に切り替えてください。
