# PM2 Welcome機能 クイックリファレンス

## 🚨 Welcome機能が動作しない場合（緊急対応）

### 最速の解決法（3ステップ）

```bash
# 1. 完全リセット
./scripts/pm2-complete-reset.sh

# 2. ログで確認
pm2 logs yamichan-bot | grep welcome

# 3. Discordでテスト
# チャンネル 1466983702667067475 で「はじめまして」を送信
```

### 診断スクリプト

```bash
# 問題を自動診断
./scripts/diagnose-welcome.sh
```

---

## 📋 チェックリスト（手動）

問題が発生したら、順番に確認:

### 1. PM2ステータス確認

```bash
pm2 list
# → yamichan-bot が online か？
```

❌ **online でない場合:**
```bash
pm2 restart yamichan-bot
```

### 2. features.conf 確認

```bash
cat features.conf | grep welcome
# → welcome=true:test または welcome=true:prod になっているか？
```

❌ **無効または存在しない場合:**
```bash
nano features.conf
# welcome=true:test に変更
pm2 restart yamichan-bot
```

### 3. 機能ロードログ確認

```bash
pm2 logs yamichan-bot | grep "bot.features.loaded"
# → features に "welcome" が含まれているか？
```

❌ **welcome が含まれない場合:**
```bash
# 完全リセットが必要
./scripts/pm2-complete-reset.sh
```

### 4. Welcome セットアップログ確認

```bash
pm2 logs yamichan-bot | grep "welcome.feature.setup"
# → セットアップログが出ているか？
```

❌ **ログが出ていない場合:**
```bash
pm2 restart yamichan-bot --update-env
pm2 logs yamichan-bot --lines 50
```

### 5. GEMINI_API_KEY 確認

```bash
grep GEMINI_API_KEY .env
# → 設定されているか？
```

❌ **設定されていない場合:**
```bash
nano .env
# GEMINI_API_KEY=... を追加
pm2 restart yamichan-bot --update-env
```

### 6. Discord Intents 確認

Discord Developer Portal:
- ✅ Server Members Intent: ON
- ✅ Message Content Intent: ON

❌ **OFFの場合:**
有効化してBotを再起動

---

## 🔧 よくある問題と即座の解決法

### 問題1: 「ログに welcome が出てこない」

```bash
# 解決法
pm2 delete yamichan-bot
pm2 start ecosystem.config.js
pm2 logs yamichan-bot
```

### 問題2: 「ローカルでは動くのにPM2では動かない」

```bash
# 解決法
./scripts/pm2-complete-reset.sh
```

### 問題3: 「/yami は動くが歓迎メッセージは動かない」

```bash
# 診断
./scripts/diagnose-welcome.sh

# ログ確認
pm2 logs yamichan-bot | grep -E "(MessageCreate|welcome.message)"

# イベントリスナーが登録されていない可能性
pm2 delete yamichan-bot
rm -rf node_modules
npm install
pm2 start ecosystem.config.js
```

### 問題4: 「環境変数が反映されない」

```bash
# ecosystem.config.js を確認
head -5 ecosystem.config.js
# → require('dotenv').config(); があるか？

# なければ追加
nano ecosystem.config.js

# 再起動
pm2 delete yamichan-bot
pm2 start ecosystem.config.js
```

### 問題5: 「チャンネルIDが間違っている」

```bash
# ログでチャンネルIDを確認
pm2 logs yamichan-bot | grep welcomeChannelId

# テスト環境: 1466983702667067475
# 本番環境: 1464999838130245742

# features.conf で環境を確認
cat features.conf | grep welcome
# → welcome=true:test または prod
```

---

## 📊 ログの見方

### 正常なログ（Welcome機能が有効）

```bash
pm2 logs yamichan-bot | grep -E "(feature|welcome)" | tail -20
```

**期待される出力:**

```
✅ .env loaded successfully
bot.features.loaded count=4 features=["yami","choco","health","welcome"]
welcome.feature.setup envTarget=test welcomeChannelId=1466983702667067475
welcome.feature.setup targetVCCount=4
```

### 異常なログ（Welcome機能が無効）

```
bot.features.loaded count=3 features=["yami","choco","health"]
# ← welcome が含まれていない
```

### 歓迎メッセージが送信された時のログ

```
welcome.message.trigger userId=123... username=TestUser
welcome.gemini.generated username=TestUser length=156
welcome.message.sent userId=123... isTestUser=false
```

### VC通知が送信された時のログ

```
welcome.vc_notify.trigger userId=123... channelId=145...
welcome.vc_notify.sent userId=123... notifiedTo=146...
```

---

## 🎯 テスト方法

### 歓迎メッセージのテスト

```bash
# 1. ログをリアルタイム監視
pm2 logs yamichan-bot --raw | grep welcome

# 2. Discord でテスト
# チャンネル ID: 1466983702667067475 (テスト)
# メッセージ: 「はじめまして」

# 3. ログ確認
# welcome.message.trigger が出れば成功
```

### VC通知のテスト

```bash
# 1. ログをリアルタイム監視
pm2 logs yamichan-bot --raw | grep vc_notify

# 2. 対象VCに参加
# VC ID: 1455097565367369764 (テスト環境)

# 3. ログ確認
# welcome.vc_notify.trigger が出れば成功
```

---

## 💾 データベースの確認

### 歓迎履歴を確認

```bash
sqlite3 data/welcome.sqlite
```

```sql
-- テーブル確認
.tables

-- 歓迎履歴を表示
SELECT * FROM welcome_history;

-- 特定ユーザーを削除（再テスト用）
DELETE FROM welcome_history WHERE user_id = 'USER_ID';

-- 終了
.quit
```

---

## 🚀 デプロイ後の確認フロー

```bash
# 1. PM2起動
pm2 start ecosystem.config.js

# 2. ステータス確認（5秒待つ）
sleep 5
pm2 status

# 3. 機能読み込み確認
pm2 logs yamichan-bot | grep bot.features

# 4. Welcome セットアップ確認
pm2 logs yamichan-bot | grep welcome.feature.setup

# 5. 環境確認
pm2 logs yamichan-bot | grep envTarget

# すべて OK なら成功！
```

---

## 📞 サポート情報収集

問題が解決しない場合、以下のコマンドで情報収集:

```bash
# デバッグ情報を収集
cat > debug-info.txt << 'EOF'
=== PM2 Status ===
$(pm2 list)

=== Features Config ===
$(cat features.conf)

=== PM2 Logs (last 100) ===
$(pm2 logs yamichan-bot --lines 100 --nostream)

=== Feature Config Test ===
$(node -e "const {loadFeatureConfig} = require('./src/utils/featureConfig'); console.log(JSON.stringify(loadFeatureConfig(), null, 2));")
EOF

cat debug-info.txt
```

このファイルを共有してください。

---

## ⚡ 最短の解決パス

```bash
# これで99%の問題が解決します
./scripts/pm2-complete-reset.sh
```

それでも解決しない場合:

```bash
# 診断実行
./scripts/diagnose-welcome.sh

# ログを確認
pm2 logs yamichan-bot | grep -E "(error|Error|ERROR|warn|Warn|WARN)"
```
