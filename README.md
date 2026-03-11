# やみちゃんBot

Discord Bot for やみさーばー。

**バージョン:** 3.2.0　**最終更新:** 2026年3月5日

---

## 🚀 クイックスタート

```bash
# 1. インストール
npm install

# 2. 環境設定
cp .env.example .env
# .envを編集: DISCORD_TOKEN, CLIENT_ID, GEMINI_API_KEY などを設定

# 3. コマンドデプロイ
node src/deploy-commands.js

# 4. 起動
node src/index.js              # 開発環境
pm2 start ecosystem.config.cjs # 本番環境
pm2 logs yamichan-bot          # ログ確認
```

---

## 📋 機能一覧

| 機能 | features.conf | 説明 |
|------|--------------|------|
| **Yami** | `yami=true` | メンション・スラッシュコマンドでGeminiが回答するAI会話 |
| **Omikuji** | `omikuji=true` | `/omikuji` で今日の運勢を引く（全100パターン） |
| **Choco** | `choco=true` | バレンタイン企画。保存済みチョコ画像をランダム表示 |
| **Boost** | `boost=true:prod` | サーバーブースト時に雑談掲示板へお礼メッセージを自動送信 |
| **ServerStats** | `serverstats=true:prod` | 専用チャンネルにサーバー統計・週次レポート・今日の一言・VC通知を表示 |
| **DiaryReaction** | `diaryreaction=false` | 秘密の日記への投稿をGeminiが解析し絵文字リアクションを自動付与 |
| **Health** | `health=true` | ボット自身の死活監視（内部機能） |

### 環境切替・同時更新の仕様

| features.conf の値 | 動作するサーバー |
|--------------------|----------------|
| `false` | どのサーバーにも反映しない |
| `true:test` | テストサーバーのみ |
| `true:prod` | **本番サーバー ＋ テストサーバー（同時）** |

---

## ⚙️ 設定ファイル

### features.conf（機能の有効/無効）

```conf
yami=true
choco=true
health=true
omikuji=true
boost=true:prod
serverstats=true:prod
diaryreaction=false
example=false
```

### .env（主要な環境変数）

```env
# 必須
DISCORD_TOKEN=
CLIENT_ID=
GEMINI_API_KEY=

# ServerStats
SERVERSTATS_MILESTONES=1500,2000,3000,5000
SERVERSTATS_KEYWORD_CHANNELS=   # キーワード収集対象チャンネルID（カンマ区切り）

# ServerStats VC通知（省略時はデフォルト値を使用）
VC_NOTIFY_THRESHOLD=10          # 呼び水通知の最低VC人数（デフォルト: 10）
VC_CHANCE_THRESHOLD=8           # チャンス通知の最低VC人数（デフォルト: 8）
VC_RECOMMEND_EXCLUDE_NAMES=     # 通知対象外のVC部屋名（カンマ区切り）
VC_RECOMMEND_EXCLUDE_KEYWORDS=  # 通知対象外キーワード（カンマ区切り）
VC_RECOMMEND_EXCLUDE_IDS=       # 通知対象外のVCチャンネルID（カンマ区切り、追加分のみ）
                                 # ※ コードに直書きされたIDは常に除外済み。
                                 # 　 動的に追加・削除するには /vcexclude コマンドを使用。

# DiaryReaction（秘密の日記フォーラムのチャンネルID）
DIARY_FORUM_CHANNEL_ID_TEST=
DIARY_FORUM_CHANNEL_ID_PROD=
```

詳細は `.env.example` を参照。

---

## 🔑 必要な権限

### Discord Developer Portal

`https://discord.com/developers/applications` → Bot → Privileged Gateway Intents

| Intent | 用途 |
|--------|------|
| ✅ PRESENCE INTENT | ServerStats（オンライン人数計測） |

### Bot権限（スコープ: `bot` + `applications.commands`）

| 権限 | bits値 | 用途 |
|------|--------|------|
| ✅ VIEW_CHANNEL | 1024 | 全機能（チャンネル読み取り） |
| ✅ SEND_MESSAGES | 2048 | 全機能（メッセージ送信） |
| ✅ MANAGE_MESSAGES | 8192 | imgmod・ServerStatsクリーンアップ |
| ✅ EMBED_LINKS | 16384 | ServerStats・VC通知・各Embed表示 |
| ✅ ATTACH_FILES | 32768 | ImageGen（生成画像の添付送信） |
| ✅ READ_MESSAGE_HISTORY | 65536 | ServerStats（メッセージedit用ID検索） |
| ✅ ADD_REACTIONS | 64 | DiaryReaction（絵文字リアクション付与） |
| ✅ USE_APPLICATION_COMMANDS | 2147483648 | スラッシュコマンド全般 |

### Bot招待URL

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2147609664&integration_type=0&scope=applications.commands+bot
```

> ⚠️ **以前の招待URL（permissions=1125392）は `EMBED_LINKS` / `ATTACH_FILES` / `ADD_REACTIONS` / `USE_APPLICATION_COMMANDS` が不足しています。** 再招待または権限の手動付与が必要です。

---

## 🎯 スラッシュコマンド一覧

| コマンド | 権限 | 説明 |
|---------|------|------|
| `/yami [text]` | 全員 | やみちゃんと会話する |
| `/yamihelp` | 全員 | やみちゃんの使い方を見る |
| `/yamisettings nickname on/off` | 全員 | ぴえんども呼びのON/OFF |
| `/omikuji` | 全員 | 今日の運勢を引く（全100パターン） |
| `/choco` | 全員 | ランダムなチョコ画像を表示 |
| `/img mode:...` | 全員 | 画像生成（プリセット組み立て / 完全自由入力、日本語は英訳して生成） |
| `/imgmod info/ban/unban/reset user:@xxx` | ManageMessages | ImageGen違反管理 |
| `/status` | 全員 | ボットのステータスを表示 |
| `/boost_test` | ManageGuild | ブースト通知のテスト |
| `/vcexclude add/remove/list` | ManageGuild | VC通知・おすすめ表示の除外チャンネル管理 |

### /vcexclude コマンド詳細

VC賑わい通知・おすすめ表示から除外するVCチャンネルをコマンドで管理します。コードを変更せずに除外リストを追加・削除できます。

| サブコマンド | 説明 |
|------------|------|
| `/vcexclude add #channel [reason]` | チャンネルを除外リストに追加（理由: 内部専用 / 作業部屋 / 招待制 / その他） |
| `/vcexclude remove #channel` | チャンネルを除外リストから削除 |
| `/vcexclude list` | 現在のDB管理除外チャンネル一覧を表示 |

> 📝 返答はすべてエフェメラル（本人のみ表示）。`deploy-commands.js` に `vcexclude` を追加して再デプロイが必要です。

---

# 🖼 ImageGen（自宅RTX画像生成・FLUX.1 schnell）

自宅のRTX GPU（例: RTX5080）で **FLUX.1 schnell** を用いた画像生成を行い、Discord上に画像を返す機能です。

Bot本体（GCP）と画像生成サーバー（自宅GPU）を分離する **A構成（推奨）** で動作します。


## 🏗 構成

```
Discord
   ↓
GCP（yamichan-bot / Node + pm2）
   ↓ Tailscaleなどの閉域ネットワーク
自宅GPUサーバー（ComfyUI + GPU APIラッパー）
   ↓
RTX5080で画像生成（FLUX.1 schnell）
```

* BotはGCPで常時稼働（安定）
* 画像生成は自宅GPUで実行（高速・低コスト）
* 通信はTailscaleなどの閉域接続を推奨（公開不要）

## 🎯 スラッシュコマンド

| コマンド | 説明 |
| --- | --- |
| `/img mode:preset style:... main:... scene:...` | 画風を選び、被写体とシチュエーションから自然文プロンプトを自動組み立て |
| `/img mode:free prompt:...` | プリセットを使わず完全自由入力 |

例：

```
/img mode:preset style:anime main:剣を持つ少女 scene:雨の夜の東京で強い決意の表情
```

日本語入力例（自動英訳されます）:

```
/img mode:free prompt: 雨の渋谷でネオンに照らされた映画のワンシーンのような構図
```

## ⚙️ 必要な追加環境変数（GCP側 / Bot）

`.env` に以下を追加してください。

```env
# ImageGen
GPU_API_BASE=http://100.xx.xx.xx:8787
GPU_API_TOKEN=
GPU_API_TIMEOUT_MS=120000
IMG_COOLDOWN_MS=20000
IMG_PROMPT_TRANSLATE=true
IMG_QUEUE_MAX=4
IMG_QUEUE_TIMEOUT_MS=300000
```

### 各項目の説明（Bot側）

| 変数                    | デフォルト  | 説明                                             |
| ---------------------- | --------- | ----------------------------------------------- |
| `GPU_API_BASE`         | —         | 自宅GPU APIサーバーのURL（Tailscale IP推奨）             |
| `GPU_API_TOKEN`        | —         | 任意。Bearer認証を使う場合                               |
| `GPU_API_TIMEOUT_MS`   | `120000`  | GPU APIへのリクエストタイムアウト（ms）                      |
| `IMG_COOLDOWN_MS`      | `20000`   | ユーザー単位クールダウン時間（ms）                            |
| `IMG_PROMPT_TRANSLATE` | `true`    | `true`で日本語プロンプトを英語に自動翻訳してから生成（推奨）            |
| `IMG_QUEUE_MAX`        | `4`       | Bot側キューの最大ジョブ数。満杯時は即拒否                        |
| `IMG_QUEUE_TIMEOUT_MS` | `300000`  | キュー待機タイムアウト（ms）。5分待っても未実行のジョブは自動キャンセル        |
| `IMG_SAFETY_GEMINI`    | `true`    | ~~`false`でGemini二次判定を無効化~~ → **廃止。`OPENAI_API_KEY` を使用** |
| `IMG_MOD_CHANNEL_ID`   | —         | 違反2回目以上でBotが通知を送るチャンネルID                       |
| `IMG_AUTO_DELETE_SEC`  | `0`       | 生成画像を指定秒後に自動削除（0で無効・永続）                       |

## ⚙️ 必要な環境変数（自宅GPUサーバー側）

```env
PORT=8787
HOST=0.0.0.0
GPU_API_TOKEN=                         # Bot側と同じトークン
COMFY_HOST=http://127.0.0.1:8188
COMFY_OUTPUT_DIR=D:\ComfyUI\output
WORKFLOW_PATH=D:\ComfyUI\gpu-api\workflow.json
PROMPT_NODE_ID=6
PROMPT_KEY=text
SERVER_QUEUE_MAX=8                     # サーバー側キュー最大数
SERVER_JOB_TIMEOUT_MS=150000           # 各ジョブのタイムアウト（ms）
```

## 🛡 セーフティ・荒らし対策

### 2段階プロンプトフィルタ

| 段階 | 方式 | 速度 | 対象 |
|------|------|------|------|
| 1. ローカルパターン | 正規表現マッチ | 即座（<1ms） | 排泄・性的・グロ・ヘイトなど明示的なワード |
| 2. OpenAI Moderation API | AI判定（無料） | ~300ms | ローカルをすり抜けた曖昧・迂回表現 |

`OPENAI_API_KEY` を設定するだけで有効になります。未設定の場合はローカルパターンのみで動作します（Geminiリソース不使用）。

### 違反累積BAN

| 違反回数 | 処置 |
|---------|------|
| 1回目 | 警告メッセージのみ（BAN なし） |
| 2回目 | 1時間 BAN |
| 3回目以上 | 24時間 BAN |
| 2回目以上 | 管理者チャンネル（`IMG_MOD_CHANNEL_ID`）に自動通知 |

違反記録はDBに永続保存（再起動後も継続）。

### 自動削除

`IMG_AUTO_DELETE_SEC` を設定すると、生成画像を指定秒数後に自動削除します。不適切な画像が残り続けるリスクを低減できます。

```env
IMG_AUTO_DELETE_SEC=300   # 5分後に自動削除（未設定 or 0 で永続）
```

### /imgmod コマンド（管理者用）

| サブコマンド | 説明 |
|------------|------|
| `/imgmod info user:@xxx` | 違反回数・BAN状態・最終理由を確認 |
| `/imgmod ban user:@xxx hours:24` | 指定時間BANする（デフォルト24時間） |
| `/imgmod unban user:@xxx` | BANを即時解除する |
| `/imgmod reset user:@xxx` | 違反カウントをリセットする |

ManageMessages 権限が必要。返答はすべてエフェメラル（本人のみ表示）。

## 🖥 自宅GPUサーバー側

### 推奨構成

* WSL2（Ubuntu）
* ComfyUI
* FLUX.1 schnell ワークフロー
* 軽量ExpressラッパーAPI（/generate）

### エンドポイント

```
POST /generate
{
  "prompt": "text..."
}
```

成功時は `image/png` を返却。

## 🚦 動作フロー

1. 第1フロー: `mode` を選択
2. `preset` を選んだ場合:
3. 第2フロー: `style`（人物・動物・イラスト風など）を選択
4. 第3フロー: `main` にメインの被写体を自由入力
5. 第4フロー: `scene` にシチュエーション/表情を自由入力
6. `free` を選んだ場合:
7. `prompt` に完全自由入力（プリセット情報は使わない）
8. 日本語入力ならBotが英語へ翻訳（任意設定）
9. Botが自宅GPU APIへPOST
10. ComfyUIで画像生成
11. 生成PNGをDiscordへ添付返信

## ⏱ 制限仕様

| 項目 | 仕様 |
|------|------|
| 同時生成数 | 1（GPUは1枚のため直列実行） |
| Bot側キュー | 最大 `IMG_QUEUE_MAX`（デフォルト4）件まで受付 |
| 同一ユーザー重複 | キュー内に同一ユーザーの多重エントリ不可 |
| クールダウン | 生成完了後 `IMG_COOLDOWN_MS`（デフォルト20秒）待機 |
| キュー待機上限 | `IMG_QUEUE_TIMEOUT_MS`（デフォルト5分）で自動キャンセル |
| プロンプト文字数 | 1000文字以内 |

## 🔄 キューの動作フロー

```
ユーザーA /img → キュー1番目 → 即座に生成開始 → 完了後返信
ユーザーB /img → キュー2番目 → 「2番目に並んでます」通知(ephemeral) → A完了後に自動生成 → 返信
ユーザーC /img → キュー3番目 → 「3番目に並んでます」通知 → 順番待ち
ユーザーA /img → 「すでにキューに並んでいます」(ephemeral) → 拒否
ユーザーD /img（キュー満杯時） → 「キューが満杯です」(ephemeral) → 拒否
```

## 🧪 トラブルシューティング（ImageGen）

### 生成中のまま止まる

```bash
pm2 logs yamichan-bot | grep imagegen
# GPU APIの /health でキュー状態を確認
curl http://<GPU_API_BASE>/health
# → { "ok": true, "queue": { "size": 1, "running": true } }
```

### 「キューが満杯」と表示される

* 複数ユーザーが短時間にリクエストしている状態
* `IMG_QUEUE_MAX` を増やすか、しばらく待ってから再試行

### 「クールダウン中です」と表示される

* 直前の生成完了後 `IMG_COOLDOWN_MS`（デフォルト20秒）が経過していない
* クールダウンはユーザー単位なので他のユーザーは影響を受けない

### タイムアウト

* ComfyUIが停止していないか確認
* GPUメモリ不足: `nvidia-smi` で確認
* `GPU_API_TIMEOUT_MS` を延長（重いワークフローの場合）

## 📈 将来的な拡張案

* LoRA切替オプション
* 画像サイズ指定（width/height）
* seed指定
* NSFWフィルタ
* ジョブID追跡表示（「現在〇番目が生成中」のライブ更新）
* キュー状況を確認できる `/imgstatus` コマンド

## 📝 備考

本機能は **BotとGPUを分離する設計（A案）** を前提としています。
Botの安定性を維持しつつ、自宅GPUを最大限活用する構成です。

---

## 🎴 Omikuji 詳細

`/omikuji` コマンドで今日の運勢を引きます。やみちゃんがひとことコメントします。

### 運勢と確率

| 運勢 | 確率 | パターン数 |
|------|------|-----------|
| 大吉 | 10% | 16 |
| 中吉 | 15% | 16 |
| 小吉 | 20% | 16 |
| 吉   | 15% | 16 |
| 末吉 | 20% | 16 |
| 凶   | 10% | 10 |
| 大凶 | 5%  | 10 |
| **合計** | **100%** | **100** |

各パターンには願事・恋愛・待人・商売・旅行・学問・病気の要素を3行に凝縮しています。

---

## 📊 ServerStats 詳細

専用チャンネルにボットが4種類のメッセージを常時表示します。再起動後も同じメッセージをeditし続けるため、チャンネルに新しいメッセージが増えません。

### 表示メッセージ（4スロット固定）

| スロット | キーワード | 更新頻度 |
|---------|-----------|---------|
| サーバー状況 | `サーバー状況` | 5分ごと |
| VCが賑わってるよ | `VCが賑わってるよ` | 5分ごとに評価 |
| 今日の一言 | `今日の一言` | 毎朝8時JST |
| 先週のサーバーまとめ | `先週のサーバーまとめ` | 毎時更新 |

### メッセージ管理の仕組み

- **起動時**: チャンネルを全件スキャンし、各スロットに対応するbot投稿を1件ずつ保持。重複を削除してDBにIDを記録
- **定期更新**: DBに保存したIDでeditのみ。新しいメッセージは作らない
- **スロットが見つからない場合**: 初回のみ新規sendして以後はeditを継続
- **メッセージが誰かに削除された場合**: 次回起動時のスキャンで自動補完

### サーバー状況 Embed 表示内容

| セクション | 内容 |
|----------|------|
| タイトル | 天気予報（活気インデックス）＋植物インジケーター |
| 概要 | 活気ラベル・マイルストーン・経過日数・新規参加者数 |
| 👥 Members | 全員・人間・Bot・オンライン人数（24h差分付き） |
| 🎤 Voice Channels | VC参加中・話し中・聴き専・見てるだけ |
| 🏠 VC部屋の雰囲気 | 参加者がいる部屋ごとに入りやすさと常連情報を表示 |
| 📁 Server | チャンネル数・ロール数・Boostレベル・Boost数 |
| 📔 秘密の日記 | 直近24hのリアクション件数（連携時のみ） |
| 💬 直近のキーワード | トレンドワード（環境変数設定時のみ） |

### 天気予報・植物インジケーターの基準

**天気（活気スコア = VC人数×4 + 話し中×3 + オンライン数）**

| スコア | 天気 |
|-------|------|
| 60以上 | ☀️ 快晴・賑やか |
| 30以上 | 🌤️ 晴れ・のんびり |
| 10以上 | ☁️ 曇り・静か |
| 10未満 | 🌙 夜・ひっそり |

**植物**

| スコア | 植物 |
|-------|------|
| 80以上 | 🌸 満開 |
| 40以上 | 🌳 大きく育ち中 |
| 15以上 | 🌿 育ち中 |
| 15未満 | 🌱 静かに成長中 |

### VC部屋の表示

入りやすい部屋には `✨ 入りやすいかも` バッジを表示。常連スコアが高いメンバーが何人いるか、直近入室タイムスタンプ・今日の出入り回数も合わせて表示します。

**常連スコアの計算（直近14日）**

```
常連スコア = VC参加日数 × 3点
           + 発話時間割合（発話時間/VC総時間）× 10点
           + 異なる部屋への参加数 × 1点
```

対象: なじんだメンバーロール所持かつ非オフィサーかつサーバー加入14日以上の現在VC参加者

### VC通知（2種類）

| 通知 | 発火条件 | クールダウン |
|------|---------|------------|
| **呼び水通知** | 除外チャンネルを除いたVC人数が閾値以上 かつ 入りやすい部屋が存在 | 1時間 |
| **今がチャンス通知** | 除外チャンネルを除いたVC人数が閾値以上 かつ 入りやすい部屋が全部空席 かつ 10分継続 かつ 常連さんが1人以上 | 1時間 |

「入りやすい部屋」の判定: 人数制限なし かつ 全員がスピーカーミュートでない かつ 除外対象に非該当

**通知の改善点（v3.2.0）**

- **vcTotal精度向上**: 部室・会議室など除外チャンネルの人数を賑わい判定に含めないよう修正
- **おすすめ複数部屋表示**: 入りやすい部屋を最大2部屋紹介（例: 「○○が話しかけやすそう（さっき△△さんが入ったよ）」）
- **時間帯フレーバー**: 深夜・朝・昼・夕方・夜でメッセージ文言を変化
- **直近入室ユーザー名**: 部屋ごとに「さっき〇〇さんが入ったよ」を表示
- **除外チャンネルのDB管理**: `/vcexclude` コマンドでコード変更なしに除外リストを追加・削除可能

**VC通知から除外されるチャンネル**

コードにハードコードされた除外ID（変更する場合はコードを直接編集）:

| チャンネル名 | ID |
|------------|-----|
| 企画部部室 | 1476734999662428211 |
| 広報部部室 | 1458765208481956096 |
| 制作部会議室 | 1463025949330247680 |
| ひみつの会議室 | 1452287057496903791 |
| お仕事中です | 1474023330322583633 |
| PRリーダー会議室 | 1464528705283166289 |
| 案内部部室 | 1452478942588960900 |
| 開発部会議室 | 1455762948881387691 |
| もくもく作業部屋 | 1474229636534636674 |
| ここサポ会議室 | 1458763743977668662 |

動的に追加・削除したいチャンネルは `/vcexclude add/remove` を使うか、`.env` の `VC_RECOMMEND_EXCLUDE_IDS` に追記してください。

### 今日の一言

毎朝8時JSTに更新。通常日は曜日×時間帯×季節の静的パターン、特別な日（バレンタイン・ハロウィンなど）はGemini生成。

### 週次レポート（先週のサーバーまとめ）

直近1週間のデータで毎時更新。表示内容:

- 🏆 ピークVC人数・時間帯
- 🕐 賑わいやすい時間帯TOP3
- 💬 発言した人数・総メッセージ数
- 😀 よく使われた絵文字TOP3
- 🆕 新しく仲間になった人数

### VC時間の計測方式

- **selfMute（ミュート）・selfDeaf（スピーカーミュート）中の時間はカウントしない**
- 記録されるのは「マイクON・スピーカーONで接続していた時間」のみ

### 再起動時のVC継続性

pm2 restart等でボットを再起動しても、VCセッションの集計が途切れないよう設計。

1. **teardown時**: 進行中の全VCセッションを `vc_session_checkpoints` テーブルに保存
2. **ClientReady時**: DBから復元 → Discord APIで現在の接続者をスキャン → チェックポイントを削除

---

## 📔 DiaryReaction 詳細

秘密の日記（フォーラムチャンネル）に新しいスレッドが立つと、30秒〜2分のランダム遅延後にBotが絵文字3つをリアクションします。

```conf
# features.conf
diaryreaction=true:prod   # 本番＋テスト両方で監視開始
```

---


入会から14日以内のユーザーが初心者向け雑談チャンネルで挨拶を投稿すると、GeminiがそのユーザーのIDや内容を加味した歓迎文を生成して返信します。

---

## 🔧 開発者向け

### 新機能の追加手順

1. `src/features/機能名/index.js` を作成
2. 以下の構造を実装：

```js
module.exports = {
  name: '機能名',
  description: '説明',
  enabled: () => {
    const { isFeatureEnabled } = require('../../utils/featureConfig');
    return isFeatureEnabled('機能名');
  },
  async setup(client) { /* イベントリスナー登録など */ },
  async teardown()    { /* タイマー解除など */ },
};
```

3. `features.conf` にエントリを追加
4. コマンドがある場合は `src/deploy-commands.js` にも追記して `node src/deploy-commands.js` を実行

### deploy-commands.js への vcexclude 追加

`src/deploy-commands.js` の `commands` 配列に以下を追加してください：

```js
// ===== ServerStats VC除外管理 =====
require('../commands/vcexclude').data.toJSON(),
```

または、コマンドを直接インポートする形式を使っている場合は `commands/vcexclude.js` を読み込んでください。

### ファイル構成

```
src/
├── index.js                    # エントリポイント・Discordクライアント初期化
├── core/
│   └── featureLoader.js        # features/ を自動スキャンして読み込む
├── features/
│   ├── boost/                  # サーバーブースト通知
│   ├── choco/                  # チョコ画像ランダム表示
│   ├── diary-reaction/         # 日記へのAI絵文字リアクション
│   ├── health/                 # 死活監視
│   ├── omikuji/                # おみくじ（全100パターン）
│   │   └── index.js
│   ├── serverstats/            # サーバー統計・VC通知・週次レポート・今日の一言
│   │   ├── index.js            # メインエントリ（VCセッション管理・絵文字集計含む）
│   │   ├── db.js               # DB操作
│   │   ├── formatter.js        # Embed生成
│   │   ├── dailyWord.js        # 今日の一言
│   │   ├── vcSessions.js       # VCセッション管理
│   │   ├── vcNotifier.js       # VC呼び水・チャンス通知（除外管理API含む）
│   │   ├── regularScore.js     # 常連スコア計算
│   │   ├── keywordExtractor.js # キーワード抽出
│   │   └── migrations.js       # DBスキーマ定義
│   └── yami/                   # AI会話
├── commands/
│   ├── choco.js
│   ├── help.js
│   ├── settings.js
│   ├── yami.js
│   └── vcexclude.js            # VC除外チャンネル管理コマンド（新規追加）
├── config/
│   ├── serverStatsTarget.js
│   ├── diaryReactionTarget.js
│   ├── boostTarget.js
│   └── target.js
├── db/
│   ├── migrations.js           # テーブル定義（全機能共通）
│   ├── sqlite.js               # DB接続ユーティリティ
│   └── *Repo.js                # 各機能のDBリポジトリ
└── services/
    ├── gemini.js               # Gemini API呼び出し
    ├── logger.js
    └── ...
```

### DBテーブル一覧

| テーブル名 | 用途 | 保持期間 |
|-----------|------|---------|
| `users` | ユーザー情報・設定 | 永続 |
| `conversation_state` | Yamiの会話状態 | 永続 |
| `conversation_turns` | Yamiの会話履歴 | 永続 |
| `server_stats_log` | ServerStats時系列スナップショット | 90日（ピーク上位20件は永久） |
| `member_join_log` | メンバー参加ログ | 30日 |
| `keyword_log` | キーワードトレンドログ | 7日 |
| `user_activity_daily` | ユーザー別日次活動集計 | 永続 |
| `emoji_usage` | 絵文字使用統計 | 30日 |
| `vc_session_checkpoints` | 再起動跨ぎ用VCセッション（復元後削除） | 一時 |
| `stats_message_ids` | ServerStats Embedのメッセージ ID | 永続 |
| `daily_word_message_ids` | 今日の一言のメッセージ ID | 永続 |
| `weekly_report_message_ids` | 週次レポートのメッセージ ID | 永続 |
| `vc_notify_message_ids` | VC通知のメッセージ ID | 永続 |
| `vc_notify_cooldowns` | VC通知クールダウン | 永続 |
| `vc_entry_log` | VC入室ログ（タイムスタンプ・出入り回数） | 3日 |
| `vc_excluded_channels` | VC通知・おすすめ除外チャンネル（DB管理分） | 永続 |
| `imagegen_violations` | ImageGen違反記録・BANタイムスタンプ | 永続 |

### ログの活用

```bash
pm2 logs yamichan-bot | grep serverstats
pm2 logs yamichan-bot | grep vcnotifier
pm2 logs yamichan-bot | grep omikuji
pm2 logs yamichan-bot | grep error
pm2 logs yamichan-bot --lines 100
```

---

## 🐛 トラブルシューティング

### ServerStatsが増殖してしまう / 表示されない

```bash
pm2 logs yamichan-bot | grep serverstats.cleanup
pm2 logs yamichan-bot | grep serverstats.init
```

- **増殖する**: 起動時のクリーンアップが走っているはず。ログの `missingSlots` を確認
- **表示されない**: `missing_target` ログが出ていれば次回起動時のスキャンで補完される
- **チャンネルID確認**:

| サーバー | guildId | statsChannelId |
|---------|---------|----------------|
| 本番 | 1450709451488100396 | 1473127167570477087 |
| テスト | 1455097564759330958 | 1473100058760183819 |

### VC通知が出ない / 部室系が通知に出る

```bash
pm2 logs yamichan-bot | grep vcnotifier
```

- 部室系が通知に出る場合: `/vcexclude list` で除外リストを確認し、`/vcexclude add #channel` で追加
- 除外IDをまとめて追加したい場合: `.env` の `VC_RECOMMEND_EXCLUDE_IDS` にカンマ区切りで追記して再起動

### 一般的な問題

```bash
pm2 status                        # Bot稼働確認
pm2 restart yamichan-bot          # 再起動
pm2 logs yamichan-bot --lines 50  # 直近ログ確認
```

---

## 🔄 環境の切り替え

```bash
# features.conf を編集
vi features.conf

# Bot再起動
pm2 restart yamichan-bot

# 確認
pm2 logs yamichan-bot --lines 20 | grep -E "setup|ready"
```
# Shibainu-bot
