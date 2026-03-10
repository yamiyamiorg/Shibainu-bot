# ServerStats機能 - サーバー状態可視化

## 概要

VC（ボイスチャット）参加者の状態をリアルタイムで集計し、Botのステータス（アクティビティ）に表示する機能です。

## 目的・福祉的メリット

### 心理的安全性の向上
- **「誰もいないかも」不安を減らす** - VCに入る前に状態が分かる
- **聞き役の負担ゼロ** - 「聞ける人」が可視化され、無理に話さなくてもOK
- **監視感はない** - 個人名は表示せず、統計のみ

### 参加障壁の低減
- VCに入る前に雰囲気が分かる
- 「話したい人」がいるか確認できる
- 「見てるだけ」も許容される文化を可視化

## 機能詳細

### 1. 集計内容

| 状態 | 条件 | 説明 |
|------|------|------|
| **話したい人** | マイクON | 積極的に会話に参加している |
| **聞ける人** | セルフミュート | 会話を聞いているが話していない |
| **見てるだけ** | サーバーミュート/Deafen | 完全に聴覚を遮断している |

### 2. 表示形式

#### デフォルト（compact）
```
話2 聞1 見5
```
- 最もコンパクト
- ステータス欄に収まりやすい

#### emoji形式
```
🎤2 👂1 👀5
```
- 視覚的に分かりやすい
- 絵文字で状態を表現

#### full形式
```
話したい人:2 聞ける人:1 見てるだけ:5
```
- 最も詳細
- 新規ユーザーにも分かりやすい

#### total形式
```
VC参加中: 8人
```
- シンプルに合計のみ
- 細かい内訳は不要な場合

### 3. 更新タイミング

- **定期更新**: 5分ごと
- **VC状態変化時**: 参加/退出/移動があった3秒後（即座）
  - デバウンス機能付き（短時間の複数更新を防ぐ）

### 4. 実装イメージ

Discordでは以下のように表示されます：

```
🟢 YamiChan-Bot
   話2 聞1 見5
```

※Botのステータス欄（アクティビティ）に表示

## 設定

### features.conf
```conf
# ServerStats機能（サーバー状態可視化）
serverstats=true
```

### 環境変数（オプション）

```bash
# 対象サーバーID（デフォルト: 1452110633968111656）
SERVERSTATS_GUILD_ID=1234567890123456789

# 表示フォーマット（デフォルト: compact）
# 選択肢: compact, emoji, full, total
SERVERSTATS_FORMAT=compact

# VC状態変化時の即座更新（デフォルト: true）
SERVERSTATS_UPDATE_ON_VC_CHANGE=true
```

## アーキテクチャ

### ファイル構成
```
src/
├── features/
│   └── serverstats/
│       └── index.js              # メイン機能
├── config/
│   └── serverStatsTarget.js     # 設定
└── utils/
    └── featureConfig.js          # 機能設定読み込み（共通）
```

### 動作フロー

#### 定期更新
```
5分タイマー発火
  ↓
サーバーのVC状態を取得
  ↓
各メンバーの状態を分析
  - マイクON → 話したい人
  - セルフミュート → 聞ける人
  - サーバーミュート/Deafen → 見てるだけ
  ↓
統計を集計
  ↓
フォーマットに従ってテキスト生成
  ↓
Bot.setPresence() でステータス更新
```

#### VC状態変化時
```
VoiceStateUpdate イベント発火
  ↓
参加/退出/移動をチェック
  ↓
3秒デバウンス
  ↓
統計更新（上記と同じフロー）
```

## 必要なBot権限

### 最小限の権限
- ✅ **View Channels** - VC情報を取得するため
- ✅ **Connect** - VCメンバー情報を取得するため（実際には接続しない）

### Discord Intents（重要）
Bot作成時に以下のIntentsを有効化する必要があります：

- ✅ **GUILD_VOICE_STATES** - VCの状態変化を検知
- ✅ **GUILDS** - サーバー情報の取得

**Discord Developer Portal での設定:**
1. Bot → Privileged Gateway Intents
2. ✅ Presence Intent（オプション）
3. ✅ Server Members Intent（オプション）
4. ✅ Message Content Intent（他機能で使用している場合）

### 推奨権限値

```
permissions=3145728
```

含まれる権限:
- View Channels
- Connect

### 完全なBot招待URL

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3148800&integration_type=0&scope=applications.commands+bot
```

※`YOUR_CLIENT_ID` を実際のBotのクライアントIDに置き換えてください

## テスト方法

### ステップ1: 機能を有効化

```bash
vi features.conf
```

```conf
serverstats=true
```

### ステップ2: Bot を再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot --lines 30
```

### ステップ3: ログで確認

```
serverstats.feature.setup {
  updateInterval: '5 minutes',
  targetGuildId: '1452110633968111656'
}

serverstats.updated {
  guildId: '1452110633968111656',
  guildName: 'あなたのサーバー',
  stats: { talking: 2, listening: 1, watching: 5, total: 8 },
  statusText: '話2 聞1 見5'
}
```

### ステップ4: Discordで確認

1. Discordを開く
2. メンバーリストでBotを確認
3. Botのステータスに「話2 聞1 見5」のような表示があることを確認

### ステップ5: 動作確認

1. VCに参加/退出してみる
2. マイクをON/OFFしてみる
3. 3秒後にBotのステータスが更新されることを確認

## トラブルシューティング

### ステータスが更新されない

**確認項目:**

1. ログを確認
   ```bash
   pm2 logs yamichan-bot --lines 50 | grep serverstats
   ```

2. Intentsが有効か確認
   - Discord Developer Portal → Bot → Privileged Gateway Intents
   - GUILD_VOICE_STATES が有効か

3. Bot権限を確認
   - View Channels
   - Connect

4. サーバーIDが正しいか確認
   ```bash
   # 環境変数で上書きしている場合
   echo $SERVERSTATS_GUILD_ID
   ```

### ステータスが「0 0 0」と表示される

**原因:** VCに誰もいない、またはBot除外が機能している

**対処:**
- 誰かVCに参加して確認
- ログで `stats` オブジェクトを確認

### ステータスが頻繁に変わりすぎる

**原因:** デバウンスが機能していない

**対処:**
- ログで更新頻度を確認
- 必要に応じて `UPDATE_INTERVAL` を調整
- または `SERVERSTATS_UPDATE_ON_VC_CHANGE=false` で即座更新を無効化

### Botのステータスが「オフライン」になる

**原因:** `client.user.setPresence()` のエラー

**対処:**
- ログでエラーを確認
- Botが正しくログインしているか確認

## カスタマイズ

### 表示フォーマットを変更

```bash
# .envファイルに追加
SERVERSTATS_FORMAT=emoji
```

または `src/config/serverStatsTarget.js` を編集:

```javascript
const format = process.env.SERVERSTATS_FORMAT || 'emoji';
```

### 更新間隔を変更

`src/features/serverstats/index.js`:

```javascript
// 5分 → 10分に変更
const UPDATE_INTERVAL = 10 * 60 * 1000;
```

### カスタムフォーマットを追加

`src/features/serverstats/index.js` の `formatStatusText` 関数に追加:

```javascript
if (format === 'custom') {
  return `VC: 話中${stats.talking}名 待機${stats.listening}名`;
}
```

### 集計ロジックのカスタマイズ

`analyzeVoiceStates` 関数を編集して、独自の集計ロジックを実装可能。

例: 特定のロールを持つ人だけカウント、特定のVCのみ対象、など

## プライバシーへの配慮

### 個人情報は含まない
- ユーザー名やIDは表示しない
- 統計データのみ

### 透明性
- 機能の存在をサーバーメンバーに周知
- 「何が表示されているか」を説明

### オプトアウト
必要に応じて、特定のVCを集計対象外にする機能を追加可能。

## 今後の拡張案

- 時間帯別の統計グラフ
- チャンネル別の集計
- 「話したい人募集中」など状態別メッセージ
- Webhook で外部サービスに統計を送信
- 過去の統計データの記録と可視化
- 特定のロールを持つ人の集計

## まとめ

ServerStats機能は、サーバーの「場の雰囲気」を可視化することで：

✅ VCに入る心理的障壁を下げる
✅ 「聞くだけ」「見るだけ」を許容する文化を明示
✅ コミュニティの活発さを客観的に示す

シンプルながら効果的な福祉機能です。
