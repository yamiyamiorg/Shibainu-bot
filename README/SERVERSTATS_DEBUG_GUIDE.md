# ServerStats機能 - デバッグ＆トラブルシューティングガイド

## 🐛 問題: Unknown Guild エラーが出る

```
serverstats.update.error: Unknown Guild
DiscordAPIError[10004]: Unknown Guild
```

### 原因

1. **設定されているサーバーIDが間違っている**
2. **Botがそのサーバーにいない**
3. **Botの権限が不足している**

### 解決方法

#### ステップ1: 診断スクリプトを実行

```bash
node scripts/diagnose-serverstats.js
```

このスクリプトは:
- ✅ Botトークンの確認
- ✅ Botが参加しているサーバーの一覧表示
- ✅ 対象サーバーの存在確認
- ✅ VCチャンネルの確認

#### ステップ2: 正しいサーバーIDを設定

診断スクリプトで表示されたサーバーIDを使って設定します。

**方法1: .env ファイルで設定（推奨）**

```bash
# .env ファイルに追加
SERVERSTATS_GUILD_ID=あなたのサーバーID
```

**方法2: serverStatsTarget.js を編集**

```javascript
// src/config/serverStatsTarget.js
const targetGuildId = process.env.SERVERSTATS_GUILD_ID || 'あなたのサーバーID';
```

#### ステップ3: Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 30
```

## 🔍 期待されるログの流れ

### 正常起動時:

```
serverstats.feature.setup {
  updateInterval: '5 minutes',
  targetGuildId: '...',
  format: 'compact',
  updateOnVCChange: true
}

serverstats.ready.checking_guild { targetGuildId: '...' }

serverstats.verify.fetch_success {
  guildId: '...',
  guildName: 'あなたのサーバー',
  memberCount: 100
}

serverstats.ready.updated

serverstats.periodic_updates.started { intervalMinutes: 5 }

serverstats.vc_change_listener.enabled

serverstats.updated {
  guildId: '...',
  guildName: 'あなたのサーバー',
  stats: { talking: 0, listening: 0, watching: 0, total: 0 },
  statusText: '話0 聞0 見0'
}
```

### エラー時:

```
serverstats.ready.guild_not_accessible {
  targetGuildId: '...',
  message: 'Bot is not in this guild or guild does not exist',
  availableGuilds: [
    { id: '...', name: 'サーバー1' },
    { id: '...', name: 'サーバー2' }
  ]
}

serverstats.ready.available_guilds {
  count: 2,
  guilds: ['サーバー1 (...)', 'サーバー2 (...)']
}
```

## 📋 よくある問題と解決方法

### 問題1: ログに何も出ない

**原因:** 機能が無効、またはBotが起動していない

**確認:**
```bash
cat features.conf | grep serverstats
# → serverstats=true が必要

pm2 status yamichan-bot
# → online を確認
```

**解決:**
```bash
vi features.conf
# serverstats=true を設定

pm2 restart yamichan-bot
```

### 問題2: `serverstats.ready.guild_not_accessible` が出る

**原因:** サーバーIDが間違っている、またはBotがサーバーにいない

**確認:**
```bash
node scripts/diagnose-serverstats.js
```

ログに表示される「Botが参加しているサーバー一覧」から正しいIDをコピー。

**解決:**
```bash
echo "SERVERSTATS_GUILD_ID=正しいサーバーID" >> .env
pm2 restart yamichan-bot
```

### 問題3: Botのステータスが更新されない

**原因:** Presenceの権限不足、またはIntents不足

**確認:**
1. Discord Developer Portal で Intents を確認
   - PRESENCE INTENT が有効か

2. Botのステータス更新権限があるか

**解決:**
Discord Developer Portal → Bot → Privileged Gateway Intents:
- ✅ PRESENCE INTENT を有効化

### 問題4: VCに参加してもステータスが変わらない

**原因:** VoiceStateUpdate イベントが受信されていない

**確認:**
```bash
pm2 logs yamichan-bot | grep serverstats.vc_update
```

**解決:**
1. `src/index.js` で `GuildVoiceStates` Intent が有効か確認:
   ```javascript
   intents: [
     GatewayIntentBits.GuildVoiceStates, // ← これが必要
   ]
   ```

2. Bot を再起動

### 問題5: 統計が「0 0 0」のまま

**原因:** VCチャンネルが見つからない、または権限不足

**確認:**
```bash
node scripts/diagnose-serverstats.js
# → VCチャンネルチェック を確認
```

**解決:**
1. Botに View Channels 権限があるか確認
2. VCチャンネルがサーバーに存在するか確認

## 🧪 手動テスト手順

### 完全なテストフロー

1. **診断スクリプトを実行**
   ```bash
   node scripts/diagnose-serverstats.js
   ```
   → すべて ✅ が表示されることを確認

2. **Bot を再起動**
   ```bash
   pm2 restart yamichan-bot
   pm2 logs yamichan-bot --lines 0
   ```

3. **起動ログを確認**
   - `serverstats.verify.fetch_success` が表示される
   - `serverstats.updated` が表示される

4. **Discordでステータス確認**
   - メンバーリストでBotを見る
   - ステータスに「話0 聞0 見0」のような表示がある

5. **VCに参加してテスト**
   - VCに参加
   - マイクをON/OFF
   - 3秒後にステータスが更新されることを確認

## 🔧 詳細ログの有効化

より詳細なログを見たい場合、`logger.debug` を `logger.info` に変更:

```javascript
// src/features/serverstats/index.js
logger.debug('serverstats.update.start', ...);
// ↓
logger.info('serverstats.update.start', ...);
```

## 📊 サーバーIDの取得方法

### 方法1: Discord UI

1. Discord 開発者モードを有効化
   - ユーザー設定 → アプリの設定 → 詳細設定 → 開発者モード ON

2. サーバーアイコンを右クリック → IDをコピー

### 方法2: 診断スクリプト

```bash
node scripts/diagnose-serverstats.js
```

「Botが参加しているサーバー一覧」にIDが表示されます。

## ✅ 正常動作のチェックリスト

- [ ] `node scripts/diagnose-serverstats.js` ですべて ✅
- [ ] `features.conf` で `serverstats=true` が設定されている
- [ ] Bot が起動している（`pm2 status`）
- [ ] 起動ログに `serverstats.verify.fetch_success` が表示される
- [ ] Botのステータスに統計が表示される
- [ ] VCに参加するとステータスが更新される

## 🚨 緊急時のデバッグ

すべてが失敗する場合:

```bash
# 1. Bot がログインしているか
pm2 logs yamichan-bot | grep "bot.ready"

# 2. Botが参加しているサーバーを確認
node scripts/diagnose-serverstats.js

# 3. features.conf が正しく読み込まれているか
pm2 logs yamichan-bot | grep "featureConfig.loaded"

# 4. ServerStats機能が有効化されているか
pm2 logs yamichan-bot | grep "serverstats.feature"

# 5. エラーログを確認
pm2 logs yamichan-bot --lines 200 > serverstats_debug.log
```

## 🔄 設定例

### テスト環境

```bash
# .env
SERVERSTATS_GUILD_ID=1234567890123456789
SERVERSTATS_FORMAT=compact
SERVERSTATS_UPDATE_ON_VC_CHANGE=true
```

### 本番環境

```bash
# .env
SERVERSTATS_GUILD_ID=9876543210987654321
SERVERSTATS_FORMAT=emoji
SERVERSTATS_UPDATE_ON_VC_CHANGE=true
```

## 📞 サポート

それでも解決しない場合:

1. ログ全体を保存
   ```bash
   pm2 logs yamichan-bot --lines 200 > serverstats_debug.log
   ```

2. 診断スクリプトの出力を保存
   ```bash
   node scripts/diagnose-serverstats.js > serverstats_diag.log
   ```

3. 両方のログを確認して問題を特定
