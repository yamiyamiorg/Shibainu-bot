# Analytics機能 - セットアップガイド

## 📋 概要

Analytics機能は、サーバーのテキスト・VC活動を自動収集し、管理者向けに統計を提供します。

### 収集データ

**テキストチャット:**
- メッセージ数・文字数
- 絵文字使用状況
- 添付ファイル数

**VC活動:**
- 接続時間（総時間 vs 真のアクティブ時間）
- マイクON/OFF切り替え回数
- 真のアクティブ判定（60分以内にマイク変化あり）

**除外対象:**
- セルフミュート（スピーカーのみ）
- サーバーミュート
- デフスン
- 60分間マイク状態変化なし（寝落ち疑い）

## 🚀 セットアップ

### 1. ファイル配置

```bash
# DB層
cp outputs/analytics-db.js src/features/analytics/db.js

# メイン機能
cp outputs/analytics-index.js src/features/analytics/index.js
```

### 2. features.confに追加

```bash
nano features.conf
```

以下を追加:
```conf
# Analytics機能（活動統計・管理者向け）
# 全チャンネルのテキスト・VC活動を収集
# プライバシー: 管理者のみ閲覧可能
analytics=true
```

### 3. コマンドをデプロイ

```bash
node src/deploy-commands.js
```

### 4. Bot再起動

```bash
pm2 restart yamichan-bot
pm2 logs yamichan-bot | grep analytics
```

## 📊 使い方

### /analytics コマンド

管理者のみ実行可能:

```
/analytics period:今日
/analytics period:昨日
/analytics period:過去7日  # Phase 2で実装予定
```

**出力内容:**
- テキストアクティブ Top 10
- VCアクティブ Top 10（真のアクティブ時間）
- よく使われた絵文字 Top 10
- 総計（メッセージ数、VCアクティブ時間）

## 🗄️ データベース

`data/analytics.sqlite` に保存されます。

**テーブル:**
- `user_activity_daily` — ユーザー活動日次集計
- `emoji_usage_daily` — 絵文字使用統計
- `vc_sessions` — VCセッション履歴
- `daily_reports` — Gemini要約レポート（Phase 3）
- `admin_messages` — 管理チャンネルメッセージID

## ⚠️ プライバシー配慮

- 収集データは管理者のみ閲覧可能
- 一般ユーザーには公開されません
- ランキングは表示されますが、個人識別は管理者のみ

## 🔄 Phase 2: 追加予定機能

1. **過去7日・30日の集計**
2. **テキスト常連 vs VC常連の比較**
3. **コミュニティ健全性スコア**

## 🤖 Phase 3: Gemini要約レポート

1. **日次レポート自動送信**
   - 実行時刻: 毎朝6時
   - 送信先: チャンネルID `1475011978014494752`
   - 内容: 昨日の盛り上がったトピック、よく使われた絵文字

2. **週次レポート自動送信**
   - 実行時刻: 毎週月曜朝6時
   - 内容: 今週のハイライト、テキスト vs VC常連比較

## 🐛 トラブルシューティング

### データが収集されない

```bash
# ログを確認
pm2 logs yamichan-bot | grep analytics

# DBが作成されているか確認
ls -la data/analytics.sqlite
```

### /analyticsコマンドが表示されない

```bash
# コマンドを再デプロイ
node src/deploy-commands.js

# Discord側のキャッシュをクリア（Ctrl+R）
```

### VCアクティブが0になる

**原因:** 60分以内にマイクON/OFF変化がないユーザーは除外されます。

**確認:**
```bash
# DBを直接確認
sqlite3 data/analytics.sqlite "SELECT * FROM vc_sessions WHERE is_truly_active = 0 LIMIT 10;"
```

## 📝 ログイベント

```
analytics.feature.setup           - 機能起動
analytics.message.recorded        - メッセージ記録
analytics.vc.joined               - VC参加
analytics.vc.left                 - VC退出
analytics.vc.mute_toggle          - マイクON/OFF切り替え
analytics.command.success         - コマンド実行成功
```

## 🎯 管理チャンネル設定（Phase 3用）

管理チャンネルID: `1475011978014494752`

このチャンネルに、Gemini要約レポートが**追記更新**形式で送信されます。

---

**実装完了日:** 2026-02-22
**Phase:** Phase 1（基本設計・データ収集）完了
