# デプロイ簡易チェックリスト

## ⚡ クイックバージョン（経験者向け）

```bash
# === ローカルPC ===
cd yamichan-bot
git status
git add .
git commit -m "Update to v2.2"
git push origin main

# === 本番サーバー ===
ssh user@server
cd ~/yamichan-bot
cp -r data data-backup-$(date +%Y%m%d)
cp .env .env.backup
git pull origin main
npm install
pm2 restart yamichan-bot
pm2 logs yamichan-bot
```

## 📋 チェックリスト

### ローカルPC
- [ ] バックアップ作成: `xcopy yamichan-bot yamichan-bot-backup /E /I /H`
- [ ] 重要ファイル退避（.git, .env, data）
- [ ] 新ファイルをコピー
- [ ] 重要ファイルを戻す
- [ ] `features.conf` 作成
- [ ] `npm install`
- [ ] `npm run dev` でテスト
- [ ] `git status` 確認
- [ ] `git add .`
- [ ] `git commit -m "Update to v2.2"`
- [ ] `git push origin main`
- [ ] GitHubで確認

### 本番サーバー
- [ ] SSH接続
- [ ] `cd ~/yamichan-bot`
- [ ] バックアップ: `cp -r . ../yamichan-bot-backup-$(date +%Y%m%d)`
- [ ] DBバックアップ: `cp -r data data-backup-$(date +%Y%m%d)`
- [ ] `.env` バックアップ: `cp .env .env.backup`
- [ ] `git pull origin main`
- [ ] `features.conf` 確認
- [ ] `.env` に `CLIENT_ID` 追加（必要なら）
- [ ] `npm install`
- [ ] `pm2 restart yamichan-bot`
- [ ] `pm2 status` → `online` 確認
- [ ] `pm2 logs yamichan-bot` → エラーなし確認
- [ ] Discord で動作確認

### Discord確認
- [ ] Botオンライン
- [ ] `/yami` 動作
- [ ] `/choco` 無反応（無効化されているため正常）
- [ ] `/status` 動作
- [ ] リプライチェーン動作
- [ ] `features:list` 動作

## 🚨 問題が起きたら

```bash
# 本番サーバーでロールバック
cd ~
mv yamichan-bot yamichan-bot-failed
cp -r yamichan-bot-backup-YYYYMMDD yamichan-bot
cd yamichan-bot
pm2 restart yamichan-bot
```

## 📞 ヘルプ

詳細は `DEPLOY_GUIDE.md` を参照してください。
