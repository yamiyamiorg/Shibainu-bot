# ServerStats機能 - 実装完了

## 📋 実装概要

VC参加者の状態をリアルタイムで集計し、Botのステータス（アクティビティ）に表示する「サーバー状態可視化」機能を実装しました。

### ✅ 実装した機能

1. **VC状態の自動集計**
   - 話したい人（マイクON）
   - 聞ける人（セルフミュート）
   - 見てるだけ（サーバーミュート/Deafen）

2. **リアルタイム更新**
   - 定期更新: 5分ごと
   - VC状態変化時: 即座（3秒デバウンス）

3. **柔軟な表示形式**
   - compact: `話2 聞1 見5` (デフォルト)
   - emoji: `🎤2 👂1 👀5`
   - full: `話したい人:2 聞ける人:1 見てるだけ:5`
   - total: `VC参加中: 8人`

### 🎯 福祉的メリット

- ✅ 「誰もいないかも」不安を減らす
- ✅ 聞き役の負担ゼロ（「聞ける人」が可視化される）
- ✅ 監視感はない（個人名は表示せず統計のみ）

### 📁 実装ファイル

```
src/
├── features/
│   └── serverstats/
│       └── index.js                 # メイン機能
├── config/
│   └── serverStatsTarget.js        # 設定
└── index.js                         # Intents追加（更新）

features.conf                        # serverstats設定追加

ドキュメント:
├── SERVERSTATS_FEATURE.md           # 詳細仕様書
├── SERVERSTATS_QUICKSTART.md        # 5分でセットアップ
└── SERVERSTATS_PERMISSIONS.md       # 必要な権限とIntents
```

## 🚀 インストール手順

### ステップ1: Discord Developer Portal設定（重要！）

**この設定がないと動作しません**

1. https://discord.com/developers/applications にアクセス
2. あなたのBot → **Bot**
3. **Privileged Gateway Intents** セクション
4. 以下を有効化:
   - ✅ **PRESENCE INTENT**
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT**（既存機能で使用中の場合）
5. 保存

### ステップ2: ファイルを配置

```bash
# serverstats機能ディレクトリを作成
mkdir -p src/features/serverstats

# ファイルをコピー
cp outputs/serverstats/index.js src/features/serverstats/
cp outputs/serverStatsTarget.js src/config/
cp outputs/index.js src/  # Intents更新版
cp outputs/features.conf ./
```

### ステップ3: 設定を確認

`features.conf` に以下が追加されていることを確認:

```conf
# ServerStats機能（サーバー状態可視化）
serverstats=true
```

### ステップ4: Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 30
```

ログに以下が表示されればOK:
```
serverstats.feature.setup {
  updateInterval: '5 minutes',
  targetGuildId: '...'
}

serverstats.updated {
  stats: { talking: 0, listening: 0, watching: 0, total: 0 },
  statusText: '話0 聞0 見0'
}
```

### ステップ5: Discordで確認

1. Discordを開く
2. メンバーリストでBotを確認
3. Botのステータスに「話0 聞0 見0」のような表示があることを確認

### ステップ6: 動作確認

1. VCに参加
2. マイクをONにする
3. 3秒後にBotのステータスが「話1 聞0 見0」に更新されることを確認

## 🔑 必要な権限

### Discord Intents（Developer Portal）

| Intent | 必須 | 理由 |
|--------|------|------|
| **PRESENCE INTENT** | ✅ | Botステータス更新 |
| **SERVER MEMBERS INTENT** | ✅ | VCメンバー情報取得 |
| MESSAGE CONTENT INTENT | 条件付き | 他機能で使用中の場合 |

### Bot権限（Permissions）

| 権限 | 必須 | 理由 |
|------|------|------|
| **View Channels** | ✅ | VC情報取得 |
| **Connect** | ✅ | VCメンバー情報取得 |

### 推奨Bot招待URL

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1049600&integration_type=0&scope=applications.commands+bot
```

**Boost機能と統合する場合:**

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1125376&integration_type=0&scope=applications.commands+bot
```

含まれる権限:
- View Channels
- Send Messages（Boost機能用）
- Manage Messages（Boost機能用）
- Read Message History（Boost機能用）
- Connect（ServerStats機能用）

## 🎨 表示例

Discordでは以下のように表示されます:

```
🟢 YamiChan-Bot
   話2 聞1 見5
```

※Botのステータス欄（アクティビティ）に表示

## ⚙️ カスタマイズ

### 表示フォーマットを変更

`.env` ファイルに追加:

```bash
# compact (デフォルト): 話2 聞1 見5
SERVERSTATS_FORMAT=compact

# emoji: 🎤2 👂1 👀5
# SERVERSTATS_FORMAT=emoji

# full: 話したい人:2 聞ける人:1 見てるだけ:5
# SERVERSTATS_FORMAT=full

# total: VC参加中: 8人
# SERVERSTATS_FORMAT=total
```

### 対象サーバーを変更

`.env` ファイルに追加:

```bash
SERVERSTATS_GUILD_ID=あなたのサーバーID
```

### 即座更新を無効化

`.env` ファイルに追加:

```bash
# VC状態変化時の即座更新を無効化（5分ごとの定期更新のみ）
SERVERSTATS_UPDATE_ON_VC_CHANGE=false
```

## 🐛 トラブルシューティング

### ステータスが表示されない

**最も多い原因: Intentsが有効化されていない**

1. Discord Developer Portal → Bot → Privileged Gateway Intents
2. PRESENCE INTENT と SERVER MEMBERS INTENT を有効化
3. Bot を再起動

### 「0 0 0」のまま変わらない

1. VCに参加してマイクをON/OFFして確認
2. ログで統計が正しく集計されているか確認
   ```bash
   pm2 logs yamichan-bot --lines 50 | grep serverstats
   ```

### エラー: Missing Access / Missing Permissions

1. Bot権限を確認
   - View Channels ✅
   - Connect ✅
2. または新しい招待URLで再招待

### エラー: Disallowed Intents

1. Discord Developer Portal で Intents を有効化
2. Bot を再起動

## 📊 技術仕様

### 更新タイミング

- **定期更新**: 5分ごと（`UPDATE_INTERVAL`）
- **VC変化時**: 参加/退出/移動があった3秒後
- **デバウンス**: 短時間の複数更新を防ぐ

### 集計ロジック

```javascript
// 話したい人
if (!voiceState.serverMute && !voiceState.serverDeaf && !voiceState.selfMute) {
  stats.talking++;
}

// 聞ける人
if (!voiceState.serverMute && !voiceState.serverDeaf && voiceState.selfMute) {
  stats.listening++;
}

// 見てるだけ
if (voiceState.serverMute || voiceState.serverDeaf) {
  stats.watching++;
}
```

### プライバシー配慮

- ❌ 個人名は表示しない
- ❌ ユーザーIDは表示しない
- ✅ 統計データのみ表示
- ✅ Bot除外（Botはカウントしない）

## 📚 ドキュメント

- **SERVERSTATS_FEATURE.md** - 詳細な機能仕様とアーキテクチャ
- **SERVERSTATS_QUICKSTART.md** - 5分でセットアップするガイド
- **SERVERSTATS_PERMISSIONS.md** - 必要な権限とIntentsの詳細

## ✅ デプロイチェックリスト

設定前:
- [ ] Discord Developer Portal で Intents を有効化
  - [ ] PRESENCE INTENT ✅
  - [ ] SERVER MEMBERS INTENT ✅
- [ ] Bot に必要な権限があることを確認
  - [ ] View Channels ✅
  - [ ] Connect ✅

ファイル配置:
- [ ] すべてのファイルが正しい場所に配置されている
- [ ] `src/index.js` が更新されている（Intents追加）
- [ ] `features.conf` で serverstats 機能が有効化されている

動作確認:
- [ ] Bot が正常起動する
- [ ] ログで `serverstats.feature.setup` を確認
- [ ] Botのステータスが表示される
- [ ] VCに参加してステータスが更新されることを確認

## 🎉 完了！

サーバー状態可視化機能の実装が完了しました。

この機能により、VCに入る心理的障壁が下がり、「聞くだけ」「見るだけ」も許容される文化が明示されます。

質問や問題があれば、ログファイルとドキュメントを確認してください。
