# ServerStats機能 - クイックスタート

## 5分でセットアップ

### 1. Bot Intentsを有効化（重要！）

Discord Developer Portal で設定:

1. https://discord.com/developers/applications
2. あなたのBot → Bot
3. **Privileged Gateway Intents** セクション
4. ✅ **PRESENCE INTENT** を有効化
5. ✅ **SERVER MEMBERS INTENT** を有効化
6. ✅ **MESSAGE CONTENT INTENT** を有効化（他機能で使用中の場合）
7. 保存

**この設定がないと機能しません！**

### 2. Bot権限を確認

最低限必要な権限:
- ✅ View Channels
- ✅ Connect

推奨Bot招待URL:
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3148800&integration_type=0&scope=applications.commands+bot
```

### 3. 機能を有効化

```bash
vi features.conf
```

以下を追加:
```conf
serverstats=true
```

### 4. Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 30
```

### 5. ログで確認

以下のログが表示されればOK:
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

### 6. Discordで確認

1. Discordを開く
2. メンバーリストでBotを見る
3. Botのステータスに「話0 聞0 見0」のような表示があることを確認

### 7. 動作テスト

1. VCに参加する
2. マイクをONにする
3. 3秒後にBotのステータスが「話1 聞0 見0」に変わることを確認

## 表示フォーマットを変更（オプション）

```bash
vi .env
```

以下を追加:
```bash
# compact (デフォルト): 話2 聞1 見5
# emoji: 🎤2 👂1 👀5
# full: 話したい人:2 聞ける人:1 見てるだけ:5
# total: VC参加中: 8人
SERVERSTATS_FORMAT=emoji
```

```bash
pm2 restart yamichan-bot
```

## トラブル？

### ステータスが表示されない
→ **Discord Developer Portal で Intents を有効化したか確認**

### 「0 0 0」のまま変わらない
→ VCに参加してマイクをON/OFFして確認

### エラーが出る
```bash
pm2 logs yamichan-bot --lines 50 | grep serverstats
```

詳細は `SERVERSTATS_FEATURE.md` を参照してください。
