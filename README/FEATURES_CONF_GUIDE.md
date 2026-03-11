# features.conf 環境設定ガイド

## 概要


## 設定形式

### 基本形式

```conf
機能名=有効/無効
```

**例:**
```conf
yami=true
choco=false
```


```conf
機能名=有効/無効:環境
```

**例:**
```conf
```


### テスト環境（test）

```conf
```

**使用されるID:**

| 項目 | ID | サーバー |
|------|-----|---------|
| 歓迎チャンネル | `1466983702667067475` | テスト |
| 通知先チャンネル | `1466983702667067475` | テスト |
| 案内部ロール | `1472086791837454419` | テスト |
| テストユーザー | `1107669393049128961`, `902878433799979078` | - |
| 対象VC | 4個（テスト+本番混在） | 混在 |

**対象VC（テスト環境）:**
- `1455097565367369764` (テストVC)
- `1452111129332416512` (本番VC1)
- `1461288337687183411` (本番VC2)
- `1467877616844410901` (本番VC3)

### 本番環境（prod）

```conf
```

**使用されるID:**

| 項目 | ID | サーバー |
|------|-----|---------|
| 歓迎チャンネル | `1464999838130245742` | 本番 |
| 通知先チャンネル | `1464999838130245742` | 本番 |
| 案内部ロール | `1452478070652141729` | 本番 |
| テストユーザー | `1107669393049128961`, `902878433799979078` | - |
| 対象VC | 3個（本番のみ） | 本番 |

**対象VC（本番環境）:**
- `1452111129332416512` (本番VC1)
- `1461288337687183411` (本番VC2)
- `1467877616844410901` (本番VC3)

## 環境切替の手順

### テスト環境に切り替え

```bash
# 1. features.confを編集
nano features.conf

# 2. 以下のように変更

# 3. 保存してBotを再起動
pm2 restart yamichan-bot

# 4. ログで確認
```

**期待されるログ:**
```json
{
  "level": "info",
  "envTarget": "test",
  "notificationChannelId": "1466983702667067475",
  "guideRoleId": "1472086791837454419",
  "targetVCCount": 4
}
```

### 本番環境に切り替え

```bash
# 1. features.confを編集
nano features.conf

# 2. 以下のように変更

# 3. 保存してBotを再起動
pm2 restart yamichan-bot

# 4. ログで確認
```

**期待されるログ:**
```json
{
  "level": "info",
  "envTarget": "prod",
  "notificationChannelId": "1464999838130245742",
  "guideRoleId": "1452478070652141729",
  "targetVCCount": 3
}
```

## 環境変数での上書き（オプション）

### 環境変数での上書き

`.env` ファイルまたは環境変数で個別IDを上書きできます。

```env
ENV_TARGET=prod

# 個別ID上書き（さらに優先）
```

### 優先順位

1. **環境変数の個別ID** （最優先）
2. **ENV_TARGET環境変数**
   - `ENV_TARGET=prod` または `ENV_TARGET=test`
3. **features.conf の環境設定**
4. **デフォルト**（test）

## ユースケース

### ケース1: ローカルでテスト

```conf
# features.conf
```

```bash
npm start
```

テストサーバーのチャンネルで動作確認。

### ケース2: 本番デプロイ前の最終確認

```conf
# features.conf
```

```bash
pm2 start ecosystem.config.js
pm2 logs yamichan-bot
```

テストサーバーで動作確認後、本番に切り替え。

### ケース3: 本番環境で稼働

```conf
# features.conf
```

```bash
pm2 restart yamichan-bot
```

本番サーバーで稼働。

### ケース4: 緊急停止

```conf
# features.conf
```

```bash
pm2 restart yamichan-bot
```


## トラブルシューティング

### Q: 環境を変更したのに反映されない

A: PM2を再起動してください。

```bash
pm2 restart yamichan-bot --update-env
```

または

```bash
pm2 delete yamichan-bot
pm2 start ecosystem.config.js
```

### Q: どの環境で動いているか確認したい

A: ログを確認してください。

```bash
```

出力例:
```
envTarget: test   ← テスト環境
envTarget: prod   ← 本番環境
```

### Q: 環境変数で上書きしたい

A: `.env` に追加してPM2を再起動。

```bash
# .envに追加
echo "ENV_TARGET=prod" >> .env

# 再起動
pm2 restart yamichan-bot --update-env
```

### Q: テスト環境と本番環境を同時に動かしたい

A: PM2で別インスタンスを起動。

```bash
# テスト環境
ENV_TARGET=test pm2 start ecosystem.config.js --name yamichan-bot-test

# 本番環境
ENV_TARGET=prod pm2 start ecosystem.config.js --name yamichan-bot-prod
```

## 設定例

### 例1: 完全テスト環境

```conf
# features.conf
yami=true
choco=false
health=true
```

### 例2: 完全本番環境

```conf
# features.conf
yami=true
choco=true
health=true
```


```conf
# features.conf
yami=true
choco=true
health=true
```

## まとめ

features.confで環境を簡単に切り替え:

✅ **環境変数で上書き**: `.env` に `ENV_TARGET=prod`

変更後は必ず `pm2 restart yamichan-bot` を実行！
