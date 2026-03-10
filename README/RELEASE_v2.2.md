# やみちゃんBot v2.2 - リリースノート

## 🎛️ 新機能: 機能管理システム

### 概要
GCP上で各機能（yami, choco等）を個別にON/OFFできるようになりました。レビュー未完了の機能を無効化したり、緊急時に特定機能のみ停止可能です。

## 使用シナリオ

### シナリオ1: レビュー未完了の機能を無効化

```bash
# 状況: chocoはアイデア段階でレビュー未完了
npm run features:disable choco
pm2 restart yamichan-bot

# 結果:
# ✅ yamiは通常通り動作
# ❌ chocoは無効（ユーザーが /choco を実行しても無反応）
```

### シナリオ2: レビュー完了後に有効化

```bash
# 状況: chocoのレビューが完了、本番公開OK
npm run features:enable choco
pm2 restart yamichan-bot

# 結果:
# ✅ chocoが有効化、ユーザーが使用可能に
```

### シナリオ3: 緊急時の機能停止

```bash
# 状況: yamiがエラーを起こしている
npm run features:disable yami
pm2 restart yamichan-bot

# 結果:
# ❌ yamiを一時停止
# ✅ 他の機能は継続動作
# → 問題解決後に再度有効化
```

## 実装内容

### 新規ファイル

1. **features.conf** - 設定ファイル
   ```conf
   # 機能の有効/無効を管理
   yami=true
   choco=false  # ← レビュー未完了で無効化
   health=true
   example=false
   ```

2. **src/utils/featureConfig.js** - 設定読み込みユーティリティ
   - `isFeatureEnabled(featureName)` - 機能が有効かチェック
   - `loadFeatureConfig()` - 設定ファイルを読み込み
   - 自動的に各機能の `enabled()` から呼び出される

3. **scripts/manage-features.js** - CLIツール
   ```bash
   npm run features:list     # 一覧表示
   npm run features:enable   # 有効化
   npm run features:disable  # 無効化
   ```

4. **FEATURE_MANAGEMENT.md** - 詳細ガイド

### 変更ファイル

- **src/features/yami/index.js** - featureConfig対応
- **src/features/choco/index.js** - featureConfig対応
- **src/features/health/index.js** - featureConfig対応
- **src/features/example/index.js** - featureConfig対応
- **package.json** - 機能管理スクリプト追加
- **README.md** - 機能管理セクション追加

## コマンド一覧

### 機能一覧の確認
```bash
npm run features:list
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
```

### 機能の有効化
```bash
npm run features:enable choco
pm2 restart yamichan-bot
```

### 機能の無効化
```bash
npm run features:disable choco
pm2 restart yamichan-bot
```

### 直接編集
```bash
nano features.conf
# choco=false → choco=true に変更
pm2 restart yamichan-bot
```

## 技術仕様

### 判定フロー

```
機能の enabled() が呼ばれる
  ↓
1. 環境変数チェック（例: GEMINI_API_KEY）
  ↓
2. features.conf チェック
  ↓
3. 両方OKなら有効、どちらかNGなら無効
```

### 設定ファイル形式

```conf
# コメント行
機能名=true|false
```

### パフォーマンス

- 設定ファイルは毎回読み込み（キャッシュなし）
- 起動時とfeatureLoader実行時のみ
- パフォーマンス影響はほぼゼロ

## 注意事項

### 1. Discordコマンドは残る

features.confで無効化しても、**Discordコマンド自体は登録されたまま**です。

```bash
# chocoを無効化
npm run features:disable choco
pm2 restart yamichan-bot

# この状態で:
# ✅ /choco コマンドはDiscord上に表示される
# ❌ ユーザーが実行しても無反応
```

コマンドも削除したい場合は:
1. features.confで無効化
2. `src/deploy-commands.js` からコマンド削除
3. `npm run deploy:commands` で再登録

### 2. 再起動が必要

設定変更は **pm2 restart yamichan-bot** を実行するまで反映されません。

### 3. 環境変数との関係

両方の条件を満たす必要があります:

```javascript
// yamiの場合
enabled: () => {
  // 条件1: 環境変数
  if (!process.env.GEMINI_API_KEY) return false;
  
  // 条件2: features.conf
  return isFeatureEnabled('yami');
}
```

## アップグレード方法

### 既存のv2.1からのアップグレード

```bash
# 1. コードを更新
git pull

# 2. features.conf を作成
cat > features.conf << 'EOF'
yami=true
choco=false
health=true
example=false
EOF

# 3. 再起動
pm2 restart yamichan-bot
```

### 新規インストール

```bash
# features.conf は既に含まれています
./deploy.sh
```

## トラブルシューティング

### Q: 設定を変更したのに反映されない

A: pm2 restart を実行しましたか？

```bash
pm2 restart yamichan-bot
```

### Q: 機能を有効にしたのに動かない

A: 環境変数を確認してください:

```bash
# yamiの場合
echo $GEMINI_API_KEY

# chocoの場合
echo $CHOCO_DIR
```

### Q: features.confが見つからない

A: ファイルを作成してください:

```bash
cat > features.conf << 'EOF'
yami=true
choco=false
health=true
example=false
EOF
```

## ベストプラクティス

### 1. レビュー前は無効化

```conf
# 新機能は最初から無効化状態でコミット
newfeature=false
```

### 2. 段階的ロールアウト

```bash
# 1. テスト環境で有効化
npm run features:enable choco
pm2 restart yamichan-bot

# 2. 問題なければ本番環境でも有効化
```

### 3. バックアップ

```bash
# 変更前にバックアップ
cp features.conf features.conf.backup

# 問題があれば復元
cp features.conf.backup features.conf
pm2 restart yamichan-bot
```

## v2.1からの変更点まとめ

### 新機能
- ✅ 機能管理システム
- ✅ CLIツール（features:list/enable/disable）
- ✅ features.conf による設定管理

### 新規ファイル
- ✅ features.conf
- ✅ src/utils/featureConfig.js
- ✅ scripts/manage-features.js
- ✅ FEATURE_MANAGEMENT.md

### 互換性
- ✅ v2.1との完全互換
- ✅ 既存の動作に影響なし
- ✅ features.confがない場合はデフォルトで全て有効

## ユースケース例

### 開発フロー

```bash
# 1. 新機能を追加（初期は無効）
echo "newfeature=false" >> features.conf
git add features.conf
git commit -m "Add newfeature (disabled)"

# 2. レビュー依頼
# → コードレビュー、ユーザーテスト

# 3. レビューOKなら有効化
npm run features:enable newfeature
pm2 restart yamichan-bot
```

### 緊急対応

```bash
# 問題が発生
npm run features:disable problematic-feature
pm2 restart yamichan-bot

# 調査・修正
# ...

# 修正完了後
npm run features:enable problematic-feature
pm2 restart yamichan-bot
```

## まとめ

機能管理システムにより:

✅ **レビュー未完了の機能を簡単に無効化**
✅ **本番環境での段階的ロールアウト**
✅ **緊急時の迅速な対応**
✅ **設定ファイルベースの管理**

が可能になりました。

---

**リリース日**: 2026-02-07  
**バージョン**: 2.2.0  
**互換性**: v2.1との完全互換
