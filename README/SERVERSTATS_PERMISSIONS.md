# ServerStats機能 - 必要な権限とIntents

## 必須設定: Discord Intents

**ServerStats機能を動作させるには、Discord Developer Portalで以下のIntentsを有効化する必要があります。**

### Discord Developer Portalでの設定手順

1. https://discord.com/developers/applications にアクセス
2. あなたのBot application を選択
3. 左メニューから **Bot** をクリック
4. 下にスクロールして **Privileged Gateway Intents** セクションを見つける
5. 以下のIntentsを有効化:

#### 必須Intents

| Intent | 必要性 | 理由 |
|--------|--------|------|
| **PRESENCE INTENT** | 必須 | Botのステータス更新に必要 |
| **SERVER MEMBERS INTENT** | 必須 | VCメンバー情報の取得に必要 |

#### 既存機能で使用中の可能性があるIntents

| Intent | 必要性 | 理由 |
|--------|--------|------|
| **MESSAGE CONTENT INTENT** | 条件付き | 他の機能（Yami、Boost等）で使用中の場合 |

### なぜIntentsが必要か

Discord.jsでは、プライバシー保護のため、特定の情報にアクセスするには明示的な許可（Intents）が必要です。

- **PRESENCE INTENT** - Botのステータス（アクティビティ）を更新するため
- **SERVER MEMBERS INTENT** - VCメンバーの詳細情報（ミュート状態など）を取得するため

### Intentsの確認方法

#### コード側（既に設定済みか確認）

`src/index.js` または Bot起動ファイルで以下のような設定があるか確認:

```javascript
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,  // ← これが必要
    GatewayIntentBits.GuildMembers,      // ← これも必要
  ],
});
```

**`GuildVoiceStates` と `GuildMembers` が含まれているか確認してください。**

含まれていない場合は追加してください。

## Bot権限（Permissions）

### 最小限の権限

ServerStats機能を動作させるための最小限の権限:

| 権限 | 必要性 | 理由 |
|------|--------|------|
| **View Channels** | 必須 | VCを含むチャンネル情報の取得 |
| **Connect** | 必須 | VCメンバー情報の取得（実際には接続しない） |

### 権限値の計算

```python
View Channels   = 0x0000000400 = 1024
Connect         = 0x0000100000 = 1048576
-----------------------------------------
合計            = 1049600
```

### 推奨Bot招待URL

```
https://discord.com/oauth2/authorize?client_id=1463309552320512163&permissions=1049600&integration_type=0&scope=applications.commands+bot
```

**`1463309552320512163` をあなたのBotのクライアントIDに置き換えてください。**

### 既存の権限に追加する場合

現在の権限値に以下を追加:

```
現在の権限値 + 1049600
```

例: 現在が `75776` の場合
```
75776 + 1049600 = 1125376
```

新しいURL:
```
https://discord.com/oauth2/authorize?client_id=1463309552320512163&permissions=1125376&integration_type=0&scope=applications.commands+bot
```

## 全機能を含む推奨権限セット

Boost機能とServerStats機能の両方を含む推奨権限:

| 機能 | 必要な権限 |
|------|-----------|
| **Boost** | View Channels, Send Messages, Manage Messages |
| **ServerStats** | View Channels, Connect |

### 統合権限値

```
View Channels    = 1024
Send Messages    = 2048
Manage Messages  = 8192
Read Message History = 65536
Connect          = 1048576
-----------------------------------------
合計             = 1125376
```

### 完全なBot招待URL

```
https://discord.com/oauth2/authorize?client_id=1463309552320512163&permissions=1125376&integration_type=0&scope=applications.commands+bot
```

## セキュリティ上の注意

### Intentsは慎重に

Intentsは強力な権限です。必要最小限のみ有効化してください。

- ✅ **GUILDS** - サーバー情報（ほぼすべてのBotで必要）
- ✅ **GUILD_VOICE_STATES** - VC状態の取得（ServerStats機能で必要）
- ✅ **GUILD_MEMBERS** - メンバー情報（ServerStats機能で必要）
- ⚠️ **MESSAGE_CONTENT** - メッセージ内容の取得（他機能で必要な場合のみ）

### 権限も最小限に

Botに必要以上の権限を与えないでください。

- ❌ **Administrator** - 絶対に付与しない
- ❌ **Manage Server** - 不要な場合は付与しない
- ✅ 必要な権限のみ厳選して付与

## トラブルシューティング

### エラー: Missing Access / Missing Permissions

**原因:** Bot権限が不足している

**対処:**
1. サーバー設定 → 役割 → Botの役割
2. View Channels と Connect を有効化
3. または、新しい招待URLで再招待

### エラー: Disallowed Intents

**原因:** Discord Developer Portal で Intents が有効化されていない

**対処:**
1. Discord Developer Portal にアクセス
2. Bot → Privileged Gateway Intents
3. 必要なIntentsを有効化
4. Bot を再起動

### ステータスが更新されない

**確認項目:**
1. ✅ Intents が有効化されているか（Developer Portal）
2. ✅ コード側で Intents が設定されているか（`GuildVoiceStates`, `GuildMembers`）
3. ✅ Bot権限が正しいか（View Channels, Connect）
4. ✅ Bot が正しくログインしているか

### ログにエラーが出る

```bash
pm2 logs yamichan-bot --lines 50 | grep -i "intent\|permission"
```

エラーメッセージから原因を特定してください。

## まとめ

ServerStats機能を動作させるには:

### 1. Discord Developer Portal
- ✅ PRESENCE INTENT 有効化
- ✅ SERVER MEMBERS INTENT 有効化

### 2. Bot権限
- ✅ View Channels
- ✅ Connect

### 3. コード（既に設定済みの場合が多い）
- ✅ `GatewayIntentBits.GuildVoiceStates`
- ✅ `GatewayIntentBits.GuildMembers`

これらがすべて揃って初めて、ServerStats機能が正常に動作します。

# ServerStats 必要権限（更新版）

## ✅ 推奨招待URL（正式）

以下のURLでBotを招待してください：

https://discord.com/oauth2/authorize?client_id=1463309552320512163&permissions=1125392&integration_type=0&scope=applications.commands+bot

---

## 🔑 必須権限の内訳

| 権限 | 理由 |
|------|------|
| View Channels | チャンネル情報取得 |
| Send Messages | 統計メッセージ送信 |
| Read Message History | 既存データ参照 |
| Manage Messages | メッセージ更新 |
| **Manage Channels** | ⭐ 統計チャンネル自動作成に必須 |

---

## ⚠️ よくあるエラー

### Missing Permissions (50013)

原因：
- Botに「チャンネルの管理」が無い
- カテゴリ側で権限が拒否されている

対処：
1. Botロールに「チャンネルの管理」を付与
2. 統計カテゴリの権限上書きを確認
3. 必要ならBotを再招待

---

## 🛠️ 最小運用構成（自動作成しない場合）

チャンネルを手動作成する場合は、
Manage Channels は不要です。
