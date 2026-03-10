# 機能管理ガイド

## 概要

やみちゃんBotでは、各機能を個別にON/OFFできます。レビュー未完了の機能を一時的に無効化したり、問題発生時に特定機能のみを停止することができます。

## 管理方法

### 方法1: CLIツール（推奨）

#### 機能一覧の確認

```bash
npm run features:list

# または
node scripts/manage-features.js list
```

出力例:
```
📋 機能一覧

──────────────────────────────────────────────────
yami            ✅ 有効
choco           ❌ 無効
health          ✅ 有効
example         ❌ 無効
──────────────────────────────────────────────────

💡 変更: node scripts/manage-features.js enable/disable <機能名>
💡 反映: pm2 restart yamichan-bot
```

#### 機能の有効化

```bash
npm run features:enable choco

# または
node scripts/manage-features.js enable choco
```

出力:
```
✅ choco を有効化しました

反映するには: pm2 restart yamichan-bot
```

#### 機能の無効化

```bash
npm run features:disable choco

# または
node scripts/manage-features.js disable choco
```

出力:
```
✅ choco を無効化しました

反映するには: pm2 restart yamichan-bot
```

#### 変更の反映

```bash
pm2 restart yamichan-bot
```

### 方法2: 設定ファイルの直接編集

#### 1. 設定ファイルを開く

```bash
nano features.conf
# または
vim features.conf
```

#### 2. 機能の有効/無効を変更

```conf
# features.conf

# Yami機能（AI会話）
# レビュー済み・本番環境で有効
yami=true

# Choco機能（画像共有）
# レビュー未完了・一時的に無効化
choco=false  # ← true に変更すると有効化

# Health機能（ステータス監視）
health=true

# Example機能（テンプレート）
example=false
```

#### 3. 保存して再起動

```bash
pm2 restart yamichan-bot
```

## 機能一覧

### yami（Yami機能）
- **説明**: AI会話機能
- **コマンド**: `/yami`, メンション, リプライチェーン
- **依存**: `GEMINI_API_KEY` 環境変数
- **レビュー状況**: ✅ 完了
- **推奨設定**: `true`（有効）

### choco（Choco機能）
- **説明**: ランダム画像共有
- **コマンド**: `/choco`, メンション + キーワード
- **依存**: `CHOCO_DIR` 環境変数
- **レビュー状況**: ⏳ 未完了
- **推奨設定**: `false`（無効） ← レビュー完了後に有効化

### health（Health機能）
- **説明**: ボットステータス監視
- **コマンド**: `/status`
- **依存**: なし
- **レビュー状況**: ✅ 完了
- **推奨設定**: `true`（有効）

### example（Example機能）
- **説明**: 新機能追加用テンプレート
- **コマンド**: なし
- **依存**: なし
- **レビュー状況**: N/A（開発用）
- **推奨設定**: `false`（無効）

## ユースケース

### Case 1: レビュー未完了の機能を無効化

```bash
# シナリオ: chocoがレビュー未完了
node scripts/manage-features.js disable choco
pm2 restart yamichan-bot

# → ユーザーは /choco を実行しても無反応
# → yamiは通常通り動作
```

### Case 2: レビュー完了後に有効化

```bash
# シナリオ: chocoのレビューが完了
node scripts/manage-features.js enable choco
pm2 restart yamichan-bot

# → ユーザーは /choco を使用可能に
```

### Case 3: 緊急時の機能停止

```bash
# シナリオ: yamiがエラーを起こしている
node scripts/manage-features.js disable yami
pm2 restart yamichan-bot

# → yamiを一時停止
# → 他の機能は継続動作
# → 問題解決後に再度有効化
```

### Case 4: 新機能のテスト

```bash
# シナリオ: 新機能 "newfeature" を追加

# 1. features.conf に追加
echo "newfeature=false" >> features.conf

# 2. テスト時のみ有効化
node scripts/manage-features.js enable newfeature
pm2 restart yamichan-bot

# 3. テスト完了後、無効化
node scripts/manage-features.js disable newfeature
pm2 restart yamichan-bot
```

## コマンド登録との関係

### 重要な注意点

**features.conf は機能の動作のみを制御します。Discordコマンド自体は登録されたままです。**

#### 例: chocoを無効化した場合

```bash
# chocoを無効化
node scripts/manage-features.js disable choco
pm2 restart yamichan-bot
```

この状態で:
- ✅ `/choco` コマンドはDiscord上に表示される
- ❌ ユーザーが `/choco` を実行しても無反応（Botが処理しない）

### コマンドも削除したい場合

#### 1. features.conf で無効化

```bash
node scripts/manage-features.js disable choco
```

#### 2. deploy-commands.js からコマンド削除

```javascript
// src/deploy-commands.js

const commands = [
  { name: 'yami', description: 'やみちゃんと会話する' },
  // { name: 'choco', description: 'ランダムな画像を表示' }, ← コメントアウト
  { name: 'status', description: 'ボットのステータスを表示' },
];
```

#### 3. コマンドを再登録

```bash
npm run deploy:commands
```

#### 4. Botを再起動

```bash
pm2 restart yamichan-bot
```

この場合:
- ✅ `/choco` コマンドがDiscord上から消える
- ✅ Botも処理しない

## トラブルシューティング

### Q: 設定を変更したのに反映されない

A: **pm2 restart yamichan-bot を実行しましたか？**

設定ファイルの変更は、Botを再起動するまで反映されません。

```bash
pm2 restart yamichan-bot
```

### Q: 機能を有効にしたのに動かない

A: 以下を確認してください:

1. **環境変数の設定**
   ```bash
   # yamiの場合
   echo $GEMINI_API_KEY
   
   # chocoの場合
   echo $CHOCO_DIR
   ```

2. **features.confの内容**
   ```bash
   cat features.conf | grep choco
   # → choco=true になっているか確認
   ```

3. **ログの確認**
   ```bash
   pm2 logs yamichan-bot | grep feature
   # → 機能が読み込まれているか確認
   ```

### Q: features.confが見つからない

A: 初回はfeatures.confを作成してください:

```bash
cat > features.conf << 'EOF'
# features.conf
yami=true
choco=false
health=true
example=false
EOF
```

### Q: CLIツールがエラーになる

A: Node.jsのバージョンとファイル権限を確認:

```bash
# Node.jsバージョン確認
node -v

# 実行権限付与
chmod +x scripts/manage-features.js

# 直接実行
node scripts/manage-features.js list
```

## ログ出力

機能の有効/無効はログに記録されます:

```bash
pm2 logs yamichan-bot
```

出力例:
```json
{
  "level": "info",
  "event": "featureConfig.loaded_all",
  "file": "/path/to/features.conf",
  "features": 4
}

{
  "level": "info",
  "event": "bot.features.loaded",
  "count": 2,
  "features": ["yami", "health"]
}
```

## ベストプラクティス

### 1. レビュー前は無効化

```bash
# 新機能を追加したら、まず無効化状態でコミット
yami=true
choco=false      # ← レビュー未完了
newfeature=false # ← レビュー未完了
```

### 2. 段階的なロールアウト

```bash
# 1. テストサーバーで有効化
node scripts/manage-features.js enable choco
pm2 restart yamichan-bot

# 2. 問題なければ本番サーバーでも有効化
```

### 3. ドキュメント更新

```bash
# features.conf にコメントを追加
# Choco機能（画像共有）
# レビュー: JIRA-123
# 有効化日: 2026-02-10
choco=true
```

### 4. バックアップ

```bash
# 変更前にバックアップ
cp features.conf features.conf.backup

# 問題があれば復元
cp features.conf.backup features.conf
pm2 restart yamichan-bot
```

## まとめ

機能管理システムにより:

✅ **レビュー未完了の機能を簡単に無効化**
✅ **Botを停止せずに設定変更可能**
✅ **緊急時の迅速な対応**
✅ **新機能の段階的ロールアウト**

が可能になります。
