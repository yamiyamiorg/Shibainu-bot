# やみちゃんBot - 安全なデプロイ手順（初心者向け）

## 📋 前提条件の確認

### 必要なもの
- [ ] ローカルPC（Windows想定）
- [ ] Git Bashまたはコマンドプロンプト
- [ ] 既存のyamichan-botリポジトリへのアクセス権
- [ ] GCPサーバーへのSSH接続情報
- [ ] 30分程度の作業時間

### 用語説明
- **ローカル**: あなたのPC
- **リモート**: GitHubなどのGitサーバー
- **本番サーバー**: GCP上で動いているサーバー
- **リポジトリ**: ソースコードを管理する場所

---

## 🎯 全体の流れ（概要）

```
1. ローカルでバックアップ作成
2. 新しいファイルをローカルにコピー
3. 動作確認（ローカル）
4. Gitにコミット
5. GitHubにプッシュ
6. 本番サーバーでバックアップ
7. 本番サーバーでプル
8. 本番サーバーで動作確認
9. PM2再起動
10. 動作確認（本番）
```

---

## 📍 Step 1: 現在の状況を確認（ローカルPC）

### 1-1. コマンドプロンプトを開く

**Windows:**
- `Win + R` を押す
- `cmd` と入力してEnter

または

- スタートメニューから「コマンドプロンプト」を検索

### 1-2. 既存のリポジトリに移動

```cmd
cd C:\Users\あなたのユーザー名\yamichan-bot
```

> 💡 **ヒント**: 実際のパスは異なる場合があります。  
> エクスプローラーでフォルダを開き、アドレスバーをコピーしてください。

### 1-3. 現在のブランチを確認

```cmd
git branch
```

**出力例:**
```
* main
```

`*` がついているのが現在のブランチです。通常は `main` または `master` です。

### 1-4. 未保存の変更がないか確認

```cmd
git status
```

**出力例（問題なし）:**
```
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

**出力例（変更がある場合）:**
```
On branch main
Changes not staged for commit:
  modified:   src/index.js
```

**もし変更がある場合:**

```cmd
REM 変更を一時保存
git stash

REM または変更を破棄（注意！）
git checkout .
```

---

## 📍 Step 2: ローカルでバックアップ作成

### 2-1. 現在のフォルダをバックアップ

```cmd
REM 親フォルダに移動
cd ..

REM バックアップを作成（日付付き）
xcopy yamichan-bot yamichan-bot-backup-%date:~0,4%%date:~5,2%%date:~8,2% /E /I /H
```

**確認:**
```cmd
dir
```

`yamichan-bot-backup-20260207` のようなフォルダができていればOK。

### 2-2. 元のフォルダに戻る

```cmd
cd yamichan-bot
```

---

## 📍 Step 3: 新しいファイルを配置

### 3-1. ダウンロードしたファイルを解凍

1. `yamichan-bot-v2.2.tar.gz` をダウンロード
2. 解凍ソフト（7-Zipなど）で解凍
3. `yamichan-bot` フォルダができる

### 3-2. ファイルをコピー（慎重に）

**重要なファイルは残す:**
- `.git/` フォルダ（Git管理情報）← **絶対に消さない！**
- `.env` ファイル（環境変数）← **絶対に消さない！**
- `data/` フォルダ（データベース）← **絶対に消さない！**
- `images/` フォルダ（Choco画像）← 使っていれば残す
- `node_modules/` フォルダ（削除してOK、後で再インストール）

**手順:**

#### A. まず、重要ファイルを別の場所に退避

```cmd
REM デスクトップに退避フォルダを作成
mkdir %USERPROFILE%\Desktop\yamichan-backup-temp

REM 重要ファイルをコピー
xcopy .git %USERPROFILE%\Desktop\yamichan-backup-temp\.git /E /I /H
copy .env %USERPROFILE%\Desktop\yamichan-backup-temp\
xcopy data %USERPROFILE%\Desktop\yamichan-backup-temp\data /E /I

REM Choco使っている場合
xcopy images %USERPROFILE%\Desktop\yamichan-backup-temp\images /E /I
```

#### B. 解凍した新しいファイルを上書きコピー

エクスプローラーで:
1. 解凍した `yamichan-bot` フォルダを開く
2. すべてのファイルを選択（Ctrl+A）
3. コピー（Ctrl+C）
4. 既存の `C:\Users\あなたのユーザー名\yamichan-bot` を開く
5. 貼り付け（Ctrl+V）
6. 「置き換えますか？」→「すべて置き換える」

#### C. 重要ファイルを戻す

```cmd
REM .gitフォルダを戻す
xcopy %USERPROFILE%\Desktop\yamichan-backup-temp\.git .git /E /I /H /Y

REM .envファイルを戻す
copy %USERPROFILE%\Desktop\yamichan-backup-temp\.env . /Y

REM dataフォルダを戻す
xcopy %USERPROFILE%\Desktop\yamichan-backup-temp\data data /E /I /Y

REM Choco使っている場合
xcopy %USERPROFILE%\Desktop\yamichan-backup-temp\images images /E /I /Y
```

### 3-3. 確認

```cmd
REM .gitフォルダがあるか確認
dir .git

REM .envファイルがあるか確認
dir .env

REM dataフォルダがあるか確認（Yami使用時）
dir data
```

すべて存在すればOK！

---

## 📍 Step 4: 新しい設定ファイルを作成

### 4-1. features.confを作成

```cmd
notepad features.conf
```

メモ帳が開くので、以下を入力:

```
# features.conf
yami=true
choco=false
health=true
example=false
```

保存して閉じる（Ctrl+S → Alt+F4）

### 4-2. scriptsフォルダを確認

```cmd
dir scripts
```

`manage-features.js` があればOK。

---

## 📍 Step 5: ローカルで動作確認（重要！）

### 5-1. 依存関係をインストール

```cmd
npm install
```

**エラーが出た場合:**
```cmd
REM node_modulesを削除して再インストール
rmdir /s /q node_modules
npm install
```

### 5-2. 環境変数を確認

```cmd
notepad .env
```

以下が正しく設定されているか確認:
```
DISCORD_TOKEN=あなたのトークン
CLIENT_ID=あなたのクライアントID
GEMINI_API_KEY=あなたのAPIキー
DATABASE_PATH=./data/yami.sqlite
```

### 5-3. データベース確認（Yami使用時）

```cmd
npm run db:init
```

**出力例:**
```
DB OK
```

### 5-4. テスト起動

```cmd
npm run dev
```

**正常な出力例:**
```
[2026-02-07 10:00:00] INFO bot.startup.begin
[2026-02-07 10:00:00] INFO featureConfig.loaded_all features=4
[2026-02-07 10:00:00] INFO bot.features.loaded count=2 features=["yami","health"]
[2026-02-07 10:00:01] INFO bot.ready tag=やみちゃん#1234 guilds=1
```

**Ctrl+C で停止**

**エラーが出た場合:**

1. ログを確認してエラーメッセージをコピー
2. 後述の「トラブルシューティング」を参照
3. 解決できない場合は、この時点で質問してください

### 5-5. 機能管理テスト

```cmd
npm run features:list
```

**出力例:**
```
📋 機能一覧

──────────────────────────────────────────────────
yami            ✅ 有効
choco           ❌ 無効
health          ✅ 有効
example         ❌ 無効
──────────────────────────────────────────────────
```

問題なければ次へ！

---

## 📍 Step 6: Gitにコミット

### 6-1. 変更内容を確認

```cmd
git status
```

**出力例:**
```
On branch main
Changes not staged for commit:
  modified:   src/index.js
  modified:   package.json
  ...

Untracked files:
  features.conf
  scripts/manage-features.js
  ...
```

### 6-2. 変更をステージング

```cmd
REM すべての変更を追加
git add .

REM 確認
git status
```

**出力例:**
```
On branch main
Changes to be committed:
  new file:   features.conf
  new file:   scripts/manage-features.js
  modified:   src/index.js
  ...
```

### 6-3. コミット

```cmd
git commit -m "Update to v2.2: Add feature management system"
```

**出力例:**
```
[main abc1234] Update to v2.2: Add feature management system
 25 files changed, 1500 insertions(+), 200 deletions(-)
 create mode 100644 features.conf
 create mode 100755 scripts/manage-features.js
```

---

## 📍 Step 7: GitHubにプッシュ

### 7-1. リモートを確認

```cmd
git remote -v
```

**出力例:**
```
origin  https://github.com/あなたのユーザー名/yamichan-bot.git (fetch)
origin  https://github.com/あなたのユーザー名/yamichan-bot.git (push)
```

### 7-2. プッシュ

```cmd
git push origin main
```

**ユーザー名とパスワード/トークンを求められた場合:**
- ユーザー名: GitHubのユーザー名
- パスワード: Personal Access Token（GitHubで作成したトークン）

**出力例（成功）:**
```
Enumerating objects: 50, done.
Counting objects: 100% (50/50), done.
Delta compression using up to 8 threads
Compressing objects: 100% (30/30), done.
Writing objects: 100% (35/35), 15.23 KiB | 1.52 MiB/s, done.
Total 35 (delta 20), reused 0 (delta 0), pack-reused 0
To https://github.com/あなたのユーザー名/yamichan-bot.git
   old1234..abc1234  main -> main
```

### 7-3. GitHubで確認

ブラウザで:
1. `https://github.com/あなたのユーザー名/yamichan-bot` を開く
2. 最新のコミットが表示されているか確認
3. `features.conf` などの新しいファイルが見えるか確認

---

## 📍 Step 8: 本番サーバーにSSH接続

### 8-1. SSHで接続

**Windows（コマンドプロンプト）:**
```cmd
ssh あなたのユーザー名@あなたのサーバーIP
```

**または GCP Cloud Shell を使用:**
```bash
gcloud compute ssh yamichan-bot --zone=asia-northeast1-a
```

**パスワードまたはSSHキーを入力**

### 8-2. サーバーのユーザー名を確認

```bash
whoami
pwd
```

**出力例:**
```
your-username
/home/your-username
```

---

## 📍 Step 9: 本番サーバーでバックアップ

### 9-1. ボットのフォルダに移動

```bash
cd ~/yamichan-bot
```

**フォルダがない場合:**
```bash
# リポジトリをクローン（初回のみ）
cd ~
git clone https://github.com/あなたのユーザー名/yamichan-bot.git
cd yamichan-bot
```

### 9-2. 現在の状態を確認

```bash
# 現在のブランチ
git branch

# 未保存の変更
git status

# 最新コミット
git log -1 --oneline
```

### 9-3. バックアップを作成

```bash
# 現在のフォルダをバックアップ
cd ~
cp -r yamichan-bot yamichan-bot-backup-$(date +%Y%m%d-%H%M%S)

# 確認
ls -lh yamichan-bot-backup*
```

**出力例:**
```
drwxr-xr-x 10 user user 4.0K Feb  7 10:00 yamichan-bot-backup-20260207-100000
```

### 9-4. データベースを個別バックアップ

```bash
cd ~/yamichan-bot

# dataフォルダをバックアップ
cp -r data data-backup-$(date +%Y%m%d-%H%M%S)

# .envファイルをバックアップ
cp .env .env.backup-$(date +%Y%m%d-%H%M%S)

# 確認
ls -lh *.backup* data-backup*
```

---

## 📍 Step 10: 本番サーバーでプル

### 10-1. 最新の変更を取得

```bash
cd ~/yamichan-bot

# 現在の状態を確認
git status
```

**もし変更がある場合:**
```bash
# 変更を退避
git stash

# またはリセット（注意！）
git reset --hard HEAD
```

### 10-2. プル実行

```bash
git pull origin main
```

**出力例（成功）:**
```
remote: Enumerating objects: 50, done.
remote: Counting objects: 100% (50/50), done.
remote: Compressing objects: 100% (30/30), done.
remote: Total 35 (delta 20), reused 35 (delta 20)
Unpacking objects: 100% (35/35), done.
From https://github.com/あなたのユーザー名/yamichan-bot
   old1234..abc1234  main -> main
Updating old1234..abc1234
Fast-forward
 features.conf                    |   10 +
 scripts/manage-features.js       |  250 ++++++++
 src/features/yami/index.js       |   15 +-
 ...
 25 files changed, 1500 insertions(+), 200 deletions(-)
```

### 10-3. 新しいファイルを確認

```bash
# features.confがあるか
ls -l features.conf

# scriptsフォルダ
ls -l scripts/

# 実行権限を確認
ls -l scripts/manage-features.js
ls -l deploy.sh
```

**実行権限がない場合:**
```bash
chmod +x scripts/manage-features.js
chmod +x deploy.sh
```

---

## 📍 Step 11: 本番サーバーで設定

### 11-1. features.confを確認

```bash
cat features.conf
```

**出力例:**
```
# features.conf
yami=true
choco=false
health=true
example=false
```

問題なければOK。

**もし存在しない場合:**
```bash
cat > features.conf << 'EOF'
# features.conf
yami=true
choco=false
health=true
example=false
EOF
```

### 11-2. .envファイルを確認

```bash
cat .env
```

**必要な環境変数があるか確認:**
```
DISCORD_TOKEN=...
CLIENT_ID=...
GEMINI_API_KEY=...
DATABASE_PATH=./data/yami.sqlite
```

**もしCLIENT_IDがない場合:**
```bash
# .envに追加
echo "CLIENT_ID=あなたのクライアントID" >> .env
```

### 11-3. 依存関係をインストール

```bash
npm install
```

**時間がかかります（1〜3分）**

**出力の最後:**
```
added 150 packages, and audited 151 packages in 2m
found 0 vulnerabilities
```

---

## 📍 Step 12: PM2の状態を確認

### 12-1. 現在の状態

```bash
pm2 list
```

**出力例:**
```
┌─────┬──────────────┬─────────┬─────────┬──────────┬────────┬
│ id  │ name         │ mode    │ status  │ restart  │ uptime │
├─────┼──────────────┼─────────┼─────────┼──────────┼────────┼
│ 0   │ yamichan-bot │ fork    │ online  │ 5        │ 2d     │
└─────┴──────────────┴─────────┴─────────┴──────────┴────────┴
```

### 12-2. ログを確認（別ターミナル推奨）

**新しいSSH接続を開いて:**
```bash
ssh あなたのユーザー名@あなたのサーバーIP
pm2 logs yamichan-bot
```

このターミナルはログ表示用に開いたままにします。

---

## 📍 Step 13: PM2を再起動

### 13-1. 再起動実行

**元のSSHターミナルで:**
```bash
pm2 restart yamichan-bot
```

**出力例:**
```
[PM2] Applying action restartProcessId on app [yamichan-bot](ids: [ 0 ])
[PM2] [yamichan-bot](0) ✓
```

### 13-2. ログでエラーがないか確認

**ログ表示用ターミナルで確認:**
```
[2026-02-07 10:05:00] INFO bot.startup.begin
[2026-02-07 10:05:00] INFO featureConfig.loaded_all file=/home/user/yamichan-bot/features.conf features=4
[2026-02-07 10:05:00] INFO bot.features.loaded count=2 features=["yami","health"]
[2026-02-07 10:05:01] INFO bot.ready tag=やみちゃん#1234 id=123456789 guilds=1
```

**✅ これらが出ていれば成功！**

**❌ エラーが出た場合:**

よくあるエラー:
```
ERROR: Cannot find module '../utils/featureConfig'
```
→ `npm install` を再度実行

```
ERROR: features.conf が見つかりません
```
→ Step 11-1 を再度実行

### 13-3. ステータス確認

```bash
pm2 status
```

**確認ポイント:**
- `status` が `online` になっているか
- `restart` の回数が増えすぎていないか（10回以上は異常）

---

## 📍 Step 14: Discord側で動作確認

### 14-1. 基本確認

1. Discordを開く
2. Botがオンラインになっているか確認

### 14-2. コマンドの確認

スラッシュコマンドを入力:
```
/
```

**表示されるはず:**
- `/yami`
- `/choco`（chocoが無効化されていても表示される）
- `/status`

### 14-3. Yamiを試す

```
/yami
```

または

```
@やみちゃん こんにちは
```

**期待する動作:**
- Botが応答する
- エラーメッセージが出ない

### 14-4. Chocoを試す（無効化されている）

```
/choco
```

**期待する動作:**
- 無反応（これが正常！chocoは無効化されている）

### 14-5. Statusを試す

```
/status
```

**期待する動作:**
- ステータス情報が表示される
- `yami` と `health` が有効と表示
- `choco` は表示されない（無効化されているため）

### 14-6. リプライチェーンを試す

```
@やみちゃん 今日はいい天気だね
```

Botが返信したら、その返信にリプライ:
```
[Botの返信にリプライ] そうだね！
```

**期待する動作:**
- メンションなしで会話継続

---

## 📍 Step 15: 機能管理を試す（オプション）

### 15-1. 現在の機能一覧

```bash
cd ~/yamichan-bot
npm run features:list
```

**出力:**
```
📋 機能一覧

──────────────────────────────────────────────────
yami            ✅ 有効
choco           ❌ 無効
health          ✅ 有効
example         ❌ 無効
──────────────────────────────────────────────────
```

### 15-2. Chocoを有効化してみる（テスト）

```bash
# 有効化
npm run features:enable choco

# 再起動
pm2 restart yamichan-bot

# 確認
pm2 logs yamichan-bot | grep choco
```

**Discordで試す:**
```
/choco
```

**期待する動作:**
- 画像が表示される（images/フォルダに画像がある場合）
- エラーメッセージ（images/フォルダがない場合）

### 15-3. Chocoを再度無効化

```bash
# 無効化
npm run features:disable choco

# 再起動
pm2 restart yamichan-bot
```

---

## ✅ 成功チェックリスト

すべてチェックできたら完了です！

- [ ] ローカルでバックアップ作成完了
- [ ] ローカルで `npm run dev` が正常起動
- [ ] Gitにコミット完了（`git log -1` で確認）
- [ ] GitHubにプッシュ完了（ブラウザで確認）
- [ ] 本番サーバーでバックアップ完了
- [ ] 本番サーバーで `git pull` 完了
- [ ] `npm install` 完了
- [ ] `pm2 restart yamichan-bot` 完了
- [ ] PM2のステータスが `online`
- [ ] ログにエラーがない
- [ ] Discord上でBotがオンライン
- [ ] `/yami` が動作する
- [ ] `/choco` が無反応（無効化されているため）
- [ ] `/status` が動作する
- [ ] リプライチェーンが動作する
- [ ] `npm run features:list` が動作する

---

## ⚠️ トラブルシューティング

### 問題1: `npm install` でエラー

**エラー例:**
```
npm ERR! code ENOENT
npm ERR! syscall open
npm ERR! path /home/user/yamichan-bot/package.json
```

**対処:**
```bash
# 正しいフォルダにいるか確認
pwd
# /home/user/yamichan-bot であるべき

# package.jsonがあるか確認
ls -l package.json
```

### 問題2: PM2が起動しない

**確認:**
```bash
pm2 logs yamichan-bot --lines 50
```

**よくあるエラーと対処:**

**A. `Cannot find module`**
```bash
# node_modulesを削除して再インストール
rm -rf node_modules
npm install
pm2 restart yamichan-bot
```

**B. `DISCORD_TOKEN is not defined`**
```bash
# .envファイルを確認
cat .env

# TOKENがあるか確認
grep DISCORD_TOKEN .env
```

**C. `features.conf が見つかりません`**
```bash
# features.confを作成
cat > features.conf << 'EOF'
yami=true
choco=false
health=true
example=false
EOF

pm2 restart yamichan-bot
```

### 問題3: Git pullでコンフリクト

**エラー例:**
```
error: Your local changes to the following files would be overwritten by merge:
        src/index.js
```

**対処方法A（変更を保存）:**
```bash
git stash
git pull origin main
```

**対処方法B（変更を破棄）:**
```bash
git reset --hard HEAD
git pull origin main
```

### 問題4: SSH接続できない

**エラー例:**
```
Permission denied (publickey)
```

**対処:**
```bash
# GCP Cloud Shellを使う
gcloud compute ssh yamichan-bot --zone=asia-northeast1-a
```

### 問題5: Botがオフライン

**確認:**
```bash
# PM2ステータス
pm2 status

# ログ確認
pm2 logs yamichan-bot --lines 100

# エラー行を探す
pm2 logs yamichan-bot --err --lines 50
```

---

## 🔄 ロールバック手順（問題が起きた場合）

### 本番サーバーで元に戻す

```bash
cd ~

# 現在のフォルダをリネーム
mv yamichan-bot yamichan-bot-failed

# バックアップから復元
cp -r yamichan-bot-backup-YYYYMMDD-HHMMSS yamichan-bot

# 元のフォルダに移動
cd yamichan-bot

# PM2再起動
pm2 restart yamichan-bot

# 確認
pm2 logs yamichan-bot
```

### ローカルPCで元に戻す

```cmd
cd C:\Users\あなたのユーザー名

REM 現在のフォルダをリネーム
rename yamichan-bot yamichan-bot-failed

REM バックアップから復元
xcopy yamichan-bot-backup-YYYYMMDD yamichan-bot /E /I /H
```

---

## 📞 サポート

### ログファイルの保存方法

```bash
# 本番サーバーで
pm2 logs yamichan-bot --lines 500 > ~/yamichan-error.log

# ローカルPCにダウンロード
scp あなたのユーザー名@サーバーIP:~/yamichan-error.log .
```

このログファイルを添えて質問すると回答が得やすくなります。

---

## 🎓 用語集

| 用語 | 意味 |
|------|------|
| コミット | 変更をGitに記録すること |
| プッシュ | ローカルの変更をGitHubに送ること |
| プル | GitHubの変更をローカル/サーバーに取り込むこと |
| ステージング | コミット対象を選択すること |
| ブランチ | 作業の枝分かれ。通常はmain |
| リモート | GitHub等の外部Git サーバー |
| origin | デフォルトのリモート名 |
| HEAD | 現在のコミット位置 |
| stash | 変更を一時退避 |

---

**作成者より:**  
この手順書は、Git初心者の方でも安全にデプロイできるよう、かなり詳細に書いています。不明点があれば、どの Step で詰まったかを教えてください！
