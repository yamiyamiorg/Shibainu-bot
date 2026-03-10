# アーキテクチャドキュメント

## 概要

このボットは、複数の機能を持つ統合Discordボットです。プラグイン方式のアーキテクチャを採用し、新機能の追加が容易になるよう設計されています。

## アーキテクチャ図

```
┌─────────────────────────────────────────────────────────┐
│                     Discord API                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  src/index.js                            │
│              (メインエントリーポイント)                   │
│  - Clientの初期化                                         │
│  - featureLoaderの呼び出し                                │
│  - グローバルエラーハンドリング                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│           src/core/featureLoader.js                      │
│              (機能の動的読み込み)                         │
│  - features/配下のモジュールをスキャン                     │
│  - 各機能のsetup()を実行                                  │
│  - enabled()でフィルタリング                              │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Yami    │  │  Choco   │  │  (新機能) │
│  機能    │  │  機能    │  │          │
└─────┬────┘  └─────┬────┘  └─────┬────┘
      │             │             │
      ▼             ▼             ▼
┌─────────────────────────────────────────┐
│        共通サービス・ユーティリティ      │
│  - logger                               │
│  - database (Yami用)                    │
│  - gemini (Yami用)                      │
│  - imageService (Choco用)               │
└─────────────────────────────────────────┘
```

## ディレクトリ構造の意味

### `/src/index.js`
- アプリケーションのエントリーポイント
- Discord Clientの初期化
- featureLoaderの呼び出し
- グローバルエラーハンドリング

### `/src/core/`
- コアロジック
- `featureLoader.js`: 機能モジュールの動的読み込み

### `/src/features/`
- 各機能の実装
- 各機能は独立したディレクトリ
- 必ず `index.js` を持つ

#### 機能モジュールの構造
```javascript
{
  name: string,           // 機能名(必須)
  description?: string,   // 説明(オプション)
  enabled?: () => boolean,// 有効化判定(オプション)
  setup: (client) => Promise<void> // セットアップ(必須)
}
```

### `/src/services/`
- 複数機能で使われる共通サービス
- `logger.js`: ロギング
- `gemini.js`: AI API連携
- `yamiPersona.js`: Yamiのペルソナ定義

### `/src/db/`
- データベース関連
- `sqlite.js`: SQLite接続
- `migrations.js`: マイグレーション
- `*Repo.js`: リポジトリパターン

### `/src/safety/`
- 安全性チェック
- `risk.js`: リスク検出

## データフロー

### 1. スラッシュコマンド
```
User → Discord API → Client.on(InteractionCreate)
                  → Feature Handler
                  → Service Layer
                  → Response
```

### 2. テキストメッセージ
```
User → Discord API → Client.on(MessageCreate)
                  → Feature Handler
                  → Service Layer
                  → Response
```

### 3. Yami機能の会話フロー
```
User Message
  → yami/index.js (extractCall)
  → yami/handlers.js (handleYamiText)
  → services/gemini.js (API呼び出し)
  → db/turnRepo.js (履歴保存)
  → Response
```

### 4. Choco機能の画像送信フロー
```
User Command/Mention
  → choco/index.js
  → choco/imageService.js (pickChocoImage)
  → File System (画像読み込み)
  → Response
```

## 設計原則

### 1. 疎結合
- 各機能は独立して動作
- 機能間の依存を最小化
- 共通処理はサービス層に集約

### 2. 拡張性
- 新機能は `features/` に追加するだけ
- 既存コードの変更不要
- 設定ファイル不要(自動検出)

### 3. 保守性
- 機能ごとにディレクトリ分割
- 責任の明確化
- ログによる追跡可能性

### 4. 安全性
- グローバルエラーハンドリング
- 機能単位のtry-catch
- ログによる問題の可視化

## 環境変数による制御

各機能は環境変数で有効/無効を制御:

```javascript
// Yami機能
enabled: () => !!process.env.GEMINI_API_KEY

// Choco機能
enabled: () => !!process.env.CHOCO_DIR

// カスタム機能
enabled: () => process.env.YOUR_FEATURE === 'true'
```

## エラーハンドリング階層

```
Level 1: Global (process level)
  - unhandledRejection
  - uncaughtException
  
Level 2: Feature (feature level)
  - 各機能のtry-catch
  - ログ出力
  
Level 3: Service (service level)
  - 個別サービスのエラー処理
  - リトライロジック
```

## ログ戦略

```javascript
logger.info('feature.action.status', { context })
```

- フォーマット: `機能.アクション.ステータス`
- コンテキスト: 関連情報をオブジェクトで渡す
- レベル: debug, info, warn, error

## パフォーマンス考慮事項

### 1. 非同期処理
- すべてのI/O操作は非同期
- async/awaitの適切な使用

### 2. リソース管理
- データベース接続のプール
- ファイルハンドルの適切なクローズ

### 3. レート制限
- Discord API制限の考慮
- ユーザーごとのロック機構(Choco)

## セキュリティ

### 1. 入力検証
- ユーザー入力のサニタイズ
- SQLインジェクション対策(パラメータ化)

### 2. 権限チェック
- Bot権限の確認
- ギルド限定処理

### 3. 環境変数
- 秘密情報は.envに格納
- .gitignoreで除外

## 今後の拡張案

### 1. データベース統合
- Choco機能でも統計を取る
- 使用状況の可視化

### 2. 管理コマンド
- 機能のON/OFF切り替え
- 設定変更

### 3. Webhook対応
- 外部サービスとの連携
- イベント通知

### 4. マルチサーバー対応
- サーバーごとの設定
- 機能の有効/無効制御
