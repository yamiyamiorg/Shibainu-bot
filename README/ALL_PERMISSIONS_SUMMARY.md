# 全機能の必要Bot権限 - 総まとめ

## 📊 権限の変遷

### Boost機能実装時（推奨権限）
```
権限値: 1125376

含まれる権限:
✅ View Channels (1024)
✅ Send Messages (2048)
✅ Manage Messages (8192)
✅ Read Message History (65536)
✅ Connect (1048576)
```

### ServerStats機能（専用チャンネル方式）で追加が必要
```
新たに必要:
✅ Manage Channels (16) - カテゴリ・チャンネル作成用

従来から必要:
✅ View Channels
✅ Send Messages
✅ Manage Messages
✅ Read Message History
```

## 🔢 結論: 権限値の計算

### 旧権限値（Boost機能時）
```
1125376
```

### 新権限値（ServerStats追加後）
```
1125376 + 16 = 1125392
```

**答え: YES、追加で Manage Channels (16) が必要です。**

## 📋 全機能別の必要権限

| 機能 | 必要な権限 | 権限値 |
|------|-----------|--------|
| **Boost** | View Channels, Send Messages, Manage Messages | 11264 |
| **ServerStats** | View Channels, Send Messages, Manage Messages, **Manage Channels** | 11280 |
| **Nukumori** | View Channels, Read Message History | 66560 |
| **その他** | View Channels, Send Messages | 3072 |

## 🎯 推奨Bot招待URL（全機能統合版）

### 最小限の権限
```
https://discord.com/oauth2/authorize?client_id=1463309552320512163&permissions=1125392&integration_type=0&scope=applications.commands+bot
```

**権限値: 1125392**

含まれる権限:
- ✅ **Manage Channels** (16) - ServerStats用（NEW!）
- ✅ View Channels (1024)
- ✅ Send Messages (2048)
- ✅ Manage Messages (8192)
- ✅ Read Message History (65536)
- ✅ Connect (1048576)
- ✅ Use Application Commands (2147483648)

### より安全な権限セット（推奨）
```
https://discord.com/oauth2/authorize?client_id=1463309552320512163&permissions=1125393&integration_type=0&scope=applications.commands+bot
```

**権限値: 1125393**

追加で含まれる権限:
- ✅ **Embed Links** (14336) - より良い表示のため

## 🔍 権限の詳細

### Manage Channels (16) - NEW!
**使用箇所:** ServerStats機能
**用途:**
- 「SERVER STATS」カテゴリの作成
- 「📊-statistics」チャンネルの作成
- カテゴリとチャンネルの権限設定

**なぜ必要か:**
専用チャンネル方式に変更したため、カテゴリとチャンネルを自動作成する必要があります。

### View Channels (1024)
**使用箇所:** 全機能
**用途:** チャンネルの閲覧

### Send Messages (2048)
**用途:** メッセージの送信

### Manage Messages (8192)
**使用箇所:** Boost（テストコマンド削除）, ServerStats（古いメッセージ削除）
**用途:** メッセージの削除

### Read Message History (65536)
**使用箇所:** Nukumori, ServerStats
**用途:** 過去のメッセージの読み取り

### Connect (1048576)
**使用箇所:** （将来的なVC機能用、現在は使用せず）
**用途:** VCへの接続

## ⚠️ 既存Botの対応

### すでにBotを招待済みの場合

**オプション1: 再招待（推奨）**
```bash
# 新しい招待URLでBotを再招待
# 権限が自動的に更新されます
https://discord.com/oauth2/authorize?client_id=1463309552320512163&permissions=1125392&integration_type=0&scope=applications.commands+bot
```

**オプション2: 手動で権限を追加**
1. サーバー設定 → 役割 → Botの役割
2. 「チャンネルの管理」を有効化
3. 保存

## 📊 権限チェック方法

### 方法1: Discord UI
1. サーバー設定 → 役割
2. Botの役割をクリック
3. 権限タブを確認
4. 「チャンネルの管理」がONか確認

### 方法2: ログで確認
```bash
pm2 logs yamichan-bot | grep serverstats
```

以下のエラーが出る場合は権限不足:
```
serverstats.ensure_channel.error
Missing Permissions
```

## 🔧 トラブルシューティング

### ServerStatsが動作しない場合

**症状:** カテゴリやチャンネルが作成されない

**原因:** Manage Channels 権限がない

**解決:**
```bash
# 1. 権限を確認
# サーバー設定 → 役割 → Botの役割 → 権限

# 2. 「チャンネルの管理」を有効化

# 3. Bot を再起動
pm2 restart yamichan-bot

# 4. ログで確認
pm2 logs yamichan-bot | grep serverstats.category.created
```

## 📝 まとめ

### Boost機能の時点での権限
```
権限値: 1125376
Manage Channels: ❌ 含まれていない
```

### ServerStats追加後の権限
```
権限値: 1125392 (16増加)
Manage Channels: ✅ 必要
```

**結論:**
- ServerStats機能（専用チャンネル方式）では、**追加で Manage Channels 権限が必要**です
- Boost機能の権限だけでは**不足**します
- 権限値を `1125376` → `1125392` に更新してください

## 🎯 推奨アクション

1. **新規招待の場合**
   ```
   権限値: 1125392 の招待URLを使用
   ```

2. **既存Botの場合**
   - 再招待（推奨）
   - または手動で「チャンネルの管理」を有効化

3. **確認**
   ```bash
   pm2 restart yamichan-bot
   pm2 logs yamichan-bot | grep serverstats.category.created
   ```
