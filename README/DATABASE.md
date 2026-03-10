# データベース構造ドキュメント

## 概要

やみちゃんBotは、会話履歴の管理にSQLite3を使用しています。データベースファイルは `data/yami.sqlite` に保存されます。

## データベース構造

### ERD（Entity Relationship Diagram）

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│     users       │         │  conversations   │         │      turns      │
├─────────────────┤         ├──────────────────┤         ├─────────────────┤
│ id (PK)         │◄───────┤ user_id (FK)     │◄───────┤ conversation_id │
│ discord_user_id │         │ id (PK)          │         │ (FK)            │
│ created_at      │         │ guild_key        │         │ id (PK)         │
│ updated_at      │         │ title            │         │ role            │
└─────────────────┘         │ created_at       │         │ content         │
                            │ updated_at       │         │ created_at      │
                            └──────────────────┘         └─────────────────┘
```

## テーブル詳細

### 1. users テーブル

DiscordユーザーとBotユーザーのマッピング。

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_discord_user_id 
  ON users(discord_user_id);
```

#### カラム

| カラム名 | 型 | 制約 | 説明 |
|---------|---|------|------|
| id | INTEGER | PRIMARY KEY | 内部ユーザーID |
| discord_user_id | TEXT | NOT NULL, UNIQUE | DiscordのユーザーID |
| created_at | TEXT | NOT NULL | 作成日時（ISO 8601） |
| updated_at | TEXT | NOT NULL | 更新日時（ISO 8601） |

#### インデックス
- `idx_users_discord_user_id`: discord_user_idでの高速検索

#### 用途
- DiscordユーザーIDから内部IDへの変換
- ユーザーの初回登録日時の記録

---

### 2. conversations テーブル

ギルド（サーバー）ごとのユーザー会話セッション。

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  guild_key TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_guild 
  ON conversations(user_id, guild_key);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
  ON conversations(updated_at);
```

#### カラム

| カラム名 | 型 | 制約 | 説明 |
|---------|---|------|------|
| id | INTEGER | PRIMARY KEY | 会話ID |
| user_id | INTEGER | NOT NULL, FK | usersテーブルへの外部キー |
| guild_key | TEXT | NOT NULL | DiscordギルドID |
| title | TEXT | NULL | 会話タイトル（オプション） |
| created_at | TEXT | NOT NULL | 作成日時 |
| updated_at | TEXT | NOT NULL | 最終更新日時 |

#### インデックス
- `idx_conversations_user_guild`: (user_id, guild_key)の複合ユニークインデックス
- `idx_conversations_updated_at`: 更新日時での検索・ソート用

#### 制約
- `user_id` は `users(id)` への外部キー
- CASCADE DELETE: ユーザー削除時に関連会話も削除

#### 用途
- ギルドごとにユーザーの会話を分離
- 1ユーザー × 1ギルド = 1会話セッション

---

### 3. turns テーブル

会話の各ターン（ユーザー発言とBot応答）を記録。

```sql
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'model')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_conversation_id 
  ON turns(conversation_id);

CREATE INDEX IF NOT EXISTS idx_turns_created_at 
  ON turns(created_at);
```

#### カラム

| カラム名 | 型 | 制約 | 説明 |
|---------|---|------|------|
| id | INTEGER | PRIMARY KEY | ターンID |
| conversation_id | INTEGER | NOT NULL, FK | conversationsテーブルへの外部キー |
| role | TEXT | NOT NULL, CHECK | 'user' または 'model' |
| content | TEXT | NOT NULL | メッセージ内容 |
| created_at | TEXT | NOT NULL | 作成日時 |

#### インデックス
- `idx_turns_conversation_id`: 会話IDでの検索用
- `idx_turns_created_at`: 日時での検索・ソート用

#### 制約
- `conversation_id` は `conversations(id)` への外部キー
- `role` は 'user' または 'model' のみ許可
- CASCADE DELETE: 会話削除時に関連ターンも削除

#### 用途
- 会話履歴の保存
- AIへのコンテキスト提供

---

## データフロー

### 1. 新規ユーザーの会話開始

```sql
-- 1. ユーザー登録（存在しない場合）
INSERT INTO users (discord_user_id) 
VALUES ('123456789012345678')
ON CONFLICT(discord_user_id) DO NOTHING;

-- 2. ユーザーID取得
SELECT id FROM users WHERE discord_user_id = '123456789012345678';

-- 3. 会話セッション作成（存在しない場合）
INSERT INTO conversations (user_id, guild_key) 
VALUES (1, '987654321098765432')
ON CONFLICT(user_id, guild_key) DO UPDATE SET updated_at = datetime('now');

-- 4. 会話ID取得
SELECT id FROM conversations WHERE user_id = 1 AND guild_key = '987654321098765432';

-- 5. ユーザー発言を記録
INSERT INTO turns (conversation_id, role, content) 
VALUES (1, 'user', 'こんにちは');

-- 6. Bot応答を記録
INSERT INTO turns (conversation_id, role, content) 
VALUES (1, 'model', 'こんにちは！やみだよ🌙');
```

### 2. 既存会話への追加

```sql
-- 会話履歴を取得（最新20ターン）
SELECT role, content, created_at
FROM turns
WHERE conversation_id = 1
ORDER BY created_at DESC
LIMIT 20;

-- 新しいターンを追加
INSERT INTO turns (conversation_id, role, content) 
VALUES (1, 'user', '元気？');

INSERT INTO turns (conversation_id, role, content) 
VALUES (1, 'model', 'うん、元気だよ！');

-- 会話の更新日時を更新
UPDATE conversations 
SET updated_at = datetime('now') 
WHERE id = 1;
```

## データ保持ポリシー

### 現在の実装
- **無期限保存**: すべての会話履歴を保存
- **削除機能**: 現在は未実装

### 推奨ポリシー（将来の実装）

```sql
-- 90日以上更新されていない会話を削除
DELETE FROM conversations 
WHERE updated_at < datetime('now', '-90 days');

-- または、古いターンのみ削除してサマリーを保存
DELETE FROM turns 
WHERE conversation_id IN (
  SELECT id FROM conversations 
  WHERE updated_at < datetime('now', '-30 days')
) 
AND created_at < datetime('now', '-90 days');
```

## パフォーマンス最適化

### インデックス戦略

既存のインデックスで以下のクエリが最適化されています:

1. **ユーザー検索**
   ```sql
   SELECT * FROM users WHERE discord_user_id = ?;
   -- idx_users_discord_user_id を使用
   ```

2. **会話取得**
   ```sql
   SELECT * FROM conversations WHERE user_id = ? AND guild_key = ?;
   -- idx_conversations_user_guild を使用
   ```

3. **ターン取得**
   ```sql
   SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at;
   -- idx_turns_conversation_id を使用
   ```

### VACUUM

定期的にVACUUMを実行してデータベースを最適化:

```sql
VACUUM;
```

## バックアップ・リストア

### バックアップ

```bash
# ファイルコピー（Bot停止時推奨）
cp data/yami.sqlite data/yami.sqlite.backup

# SQLiteダンプ（稼働中でも可）
sqlite3 data/yami.sqlite .dump > backup.sql
```

### リストア

```bash
# ファイルコピーから
cp data/yami.sqlite.backup data/yami.sqlite

# SQLダンプから
sqlite3 data/yami.sqlite < backup.sql
```

## マイグレーション

マイグレーションは `src/db/migrations.js` で管理されています。

### 新しいマイグレーション追加

```javascript
// src/db/migrations.js に追加

async function migrate(dbPath) {
  const db = new Database(dbPath);
  
  await db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  
  // 新しいマイグレーション
  const currentVersion = await db.get(
    'SELECT MAX(version) as version FROM schema_version'
  );
  
  if (!currentVersion || currentVersion.version < 2) {
    // バージョン2のマイグレーション
    await db.run(`
      ALTER TABLE users ADD COLUMN nickname TEXT;
    `);
    
    await db.run(`
      INSERT INTO schema_version (version, applied_at) 
      VALUES (2, datetime('now'));
    `);
  }
  
  await db.close();
}
```

## トラブルシューティング

### データベースロック

```bash
# ロック状態を確認
sqlite3 data/yami.sqlite "PRAGMA busy_timeout = 5000;"

# ロック解除（最終手段）
fuser -k data/yami.sqlite
```

### データベース破損

```bash
# 整合性チェック
sqlite3 data/yami.sqlite "PRAGMA integrity_check;"

# 修復試行
sqlite3 data/yami.sqlite ".recover" | sqlite3 data/yami_recovered.sqlite
```

### サイズ確認

```bash
# ファイルサイズ
ls -lh data/yami.sqlite

# テーブルごとのレコード数
sqlite3 data/yami.sqlite <<EOF
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL
SELECT 'turns', COUNT(*) FROM turns;
EOF
```

## セキュリティ考慮事項

### 個人情報保護
- Discord User IDは個人識別可能情報
- 会話内容にも機密情報が含まれる可能性

### アクセス制御
```bash
# ファイルパーミッション設定
chmod 600 data/yami.sqlite
chown botuser:botuser data/yami.sqlite
```

### バックアップの暗号化
```bash
# GPGで暗号化
gpg -c data/yami.sqlite

# 復号化
gpg data/yami.sqlite.gpg
```
