# Choco機能のストレージ影響分析

## 前提条件

- **画像サイズ**: PNG 400KB/枚
- **GCPインスタンス**: e2-micro（標準）
- **標準ディスク**: 10GB（デフォルト）

## ストレージ容量の計算

### 画像枚数とディスク使用量

| 画像枚数 | 合計サイズ | 10GBに対する割合 |
|----------|-----------|-----------------|
| 10枚 | 4 MB | 0.04% |
| 50枚 | 20 MB | 0.2% |
| 100枚 | 40 MB | 0.4% |
| 250枚 | 100 MB | 1% |
| 500枚 | 200 MB | 2% |
| 1,000枚 | 400 MB | 4% |
| 2,500枚 | 1 GB | 10% |
| 5,000枚 | 2 GB | 20% |
| 10,000枚 | 4 GB | 40% |

### システムとアプリの基本使用量

```
OS（Ubuntu）: 約 1.5-2 GB
Node.js + 依存関係: 約 200-300 MB
ログファイル: 約 50-100 MB（運用による）
データベース: 約 10-50 MB（Yami会話履歴）
予備領域: 約 1 GB（推奨）
─────────────────────────────────
合計（基本）: 約 3-4 GB
```

**残り使用可能容量**: 約 6-7 GB

## 結論

### 🟢 安全な範囲（推奨）

**100-500枚（40-200 MB）**
- ディスク使用率: 0.4-2%
- 影響: ほぼなし
- 推奨用途: テスト、小規模コミュニティ

### 🟡 注意が必要な範囲

**500-2,500枚（200 MB - 1 GB）**
- ディスク使用率: 2-10%
- 影響: 軽微
- 推奨用途: 中規模コミュニティ
- 対策: 月1回の容量確認

### 🔴 危険な範囲

**2,500枚以上（1 GB以上）**
- ディスク使用率: 10%以上
- 影響: 大きい
- リスク: ディスクフル、性能低下
- 対策: ディスク拡張またはCloud Storage移行を検討

## 現実的なシナリオ分析

### シナリオ1: 趣味・個人用（10-50枚）

```
画像数: 30枚
使用量: 12 MB
影響度: ★☆☆☆☆（ほぼゼロ）

評価: 全く問題なし
```

### シナリオ2: 小規模コミュニティ（50-250枚）

```
画像数: 150枚
使用量: 60 MB
影響度: ★☆☆☆☆（無視できる）

評価: 問題なし
```

### シナリオ3: 中規模コミュニティ（250-1,000枚）

```
画像数: 500枚
使用量: 200 MB
影響度: ★★☆☆☆（軽微）

評価: 定期的な容量チェック推奨
```

### シナリオ4: 大規模（1,000枚以上）

```
画像数: 2,000枚
使用量: 800 MB
影響度: ★★★☆☆（中程度）

評価: 容量管理が必要
対策: 古い画像の削除、または外部ストレージ化
```

## 容量監視方法

### 1. ディスク使用量の確認

```bash
# 全体の使用状況
df -h

# imagesフォルダのサイズ
du -sh ~/yamichan-bot/images

# 画像ファイル数
ls ~/yamichan-bot/images/*.{png,jpg,jpeg} 2>/dev/null | wc -l

# 画像ごとのサイズ一覧
du -h ~/yamichan-bot/images/* | sort -h
```

**出力例:**
```
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        10G  3.5G  6.5G  35% /
```

### 2. 自動監視スクリプト

```bash
#!/bin/bash
# scripts/check-storage.sh

IMAGES_DIR="$HOME/yamichan-bot/images"
THRESHOLD_MB=500

if [ ! -d "$IMAGES_DIR" ]; then
    echo "⚠️  imagesフォルダが見つかりません"
    exit 0
fi

# 画像フォルダのサイズ（MB）
SIZE_MB=$(du -sm "$IMAGES_DIR" | cut -f1)
COUNT=$(find "$IMAGES_DIR" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) | wc -l)

echo "📊 Choco画像ストレージ状況"
echo "────────────────────────"
echo "画像数: $COUNT 枚"
echo "使用量: ${SIZE_MB} MB"
echo ""

if [ "$SIZE_MB" -gt "$THRESHOLD_MB" ]; then
    echo "⚠️  警告: ${THRESHOLD_MB}MB を超えています"
    echo "💡 対策を検討してください"
else
    echo "✅ 容量は問題ありません"
fi
```

**使い方:**
```bash
chmod +x scripts/check-storage.sh
./scripts/check-storage.sh
```

### 3. Cronで定期チェック（オプション）

```bash
# 週1回チェック
crontab -e

# 追加
0 9 * * 1 /home/user/yamichan-bot/scripts/check-storage.sh >> /home/user/yamichan-bot/logs/storage-check.log 2>&1
```

## リスク管理戦略

### 戦略1: 画像数制限（推奨）

**目標: 500枚以内（200 MB）**

```bash
# 古い画像を自動削除（500枚を超えたら削除）
# scripts/cleanup-old-images.sh

MAX_IMAGES=500
IMAGES_DIR="$HOME/yamichan-bot/images"

COUNT=$(find "$IMAGES_DIR" -type f \( -name "*.png" -o -name "*.jpg" \) | wc -l)

if [ "$COUNT" -gt "$MAX_IMAGES" ]; then
    EXCESS=$((COUNT - MAX_IMAGES))
    echo "🗑️  ${EXCESS}枚の古い画像を削除します"
    
    find "$IMAGES_DIR" -type f \( -name "*.png" -o -name "*.jpg" \) -printf '%T+ %p\n' \
        | sort | head -n "$EXCESS" | cut -d' ' -f2- \
        | xargs rm -f
    
    echo "✅ 完了: $(find "$IMAGES_DIR" -type f | wc -l)枚"
fi
```

### 戦略2: サイズ制限

**CHOCO_MAX_MB を設定済み（デフォルト20MB）**

```env
# .env
CHOCO_MAX_MB=20  # 20MBを超える画像は除外
```

これにより:
- 1枚あたり最大20MB
- 実際は400KB程度なので問題なし
- 誤って巨大ファイルが混入しても安全

### 戦略3: ディスク拡張（最終手段）

**GCPでディスクサイズを拡張:**

```bash
# GCPコンソールで
1. Compute Engine → VMインスタンス
2. 停止 → 編集
3. ブートディスク → サイズ変更（10GB → 20GB等）
4. 保存 → 起動

# サーバー内で
sudo growpart /dev/sda 1
sudo resize2fs /dev/sda1
df -h  # 確認
```

**コスト:**
- 10GB: 無料枠内
- 20GB: 約$1-2/月
- 30GB: 約$3-4/月

### 戦略4: Cloud Storage移行（大規模向け）

**1,000枚以上の場合:**

```
GCS（Google Cloud Storage）に画像を保存
↓
Bot は URL を参照して送信
↓
GCEディスクは圧迫されない
```

**コスト:**
- 1GB: $0.02/月（東京リージョン）
- 5GB: $0.10/月

## 推奨設定

### 小規模（デフォルト）

```env
# .env
CHOCO_DIR=./images
CHOCO_MAX_MB=20
CHOCO_STABLE_SEC=5
```

**想定:**
- 画像数: 100-500枚
- 容量: 40-200 MB
- 影響: ほぼなし

### 中規模

```env
# .env
CHOCO_DIR=./images
CHOCO_MAX_MB=10  # より厳格に
CHOCO_STABLE_SEC=5
```

**運用:**
- 月1回、古い画像を手動削除
- 500枚を目安に維持

### 大規模

```
→ Cloud Storage 移行を推奨
```

## モニタリングダッシュボード（簡易版）

```bash
# scripts/status-dashboard.sh

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  やみちゃんBot ストレージ状況"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ディスク全体
echo "📊 ディスク全体:"
df -h / | awk 'NR==2 {print "  使用: "$3" / "$2" ("$5")"}'
echo ""

# 画像フォルダ
if [ -d "$HOME/yamichan-bot/images" ]; then
    IMG_SIZE=$(du -sh "$HOME/yamichan-bot/images" | cut -f1)
    IMG_COUNT=$(find "$HOME/yamichan-bot/images" -type f \( -name "*.png" -o -name "*.jpg" \) | wc -l)
    echo "🖼️  Choco画像:"
    echo "  枚数: ${IMG_COUNT}枚"
    echo "  容量: ${IMG_SIZE}"
else
    echo "🖼️  Choco画像: フォルダなし"
fi
echo ""

# データベース
if [ -f "$HOME/yamichan-bot/data/yami.sqlite" ]; then
    DB_SIZE=$(du -sh "$HOME/yamichan-bot/data/yami.sqlite" | cut -f1)
    echo "💾 データベース: ${DB_SIZE}"
else
    echo "💾 データベース: なし"
fi
echo ""

# ログ
if [ -d "$HOME/yamichan-bot/logs" ]; then
    LOG_SIZE=$(du -sh "$HOME/yamichan-bot/logs" | cut -f1)
    echo "📝 ログ: ${LOG_SIZE}"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

## まとめ

### 🎯 結論

**400KB/枚のPNG画像でChocoを実装しても、GCP容量への影響はほぼありません。**

| 画像数 | 容量 | 影響 | 評価 |
|--------|------|------|------|
| 100枚 | 40 MB | 0.4% | ✅ 全く問題なし |
| 500枚 | 200 MB | 2% | ✅ 問題なし |
| 1,000枚 | 400 MB | 4% | 🟡 軽微（管理推奨） |
| 2,500枚 | 1 GB | 10% | 🔴 注意（対策必要） |

### 💡 推奨事項

1. **初期段階（100-500枚）**
   - 何も気にせず使用OK
   - 月1回の容量確認で十分

2. **成長期（500-1,000枚）**
   - `df -h` で月1回チェック
   - 古い画像を適宜削除

3. **大規模（1,000枚以上）**
   - 自動削除スクリプト導入
   - または Cloud Storage 移行

### ⚙️ 安全機能（実装済み）

- ✅ `CHOCO_MAX_MB=20` でファイルサイズ制限
- ✅ 許可拡張子のみ読み込み（png, jpg, jpeg, webp, gif）
- ✅ 書き込み中ファイルは除外（`CHOCO_STABLE_SEC=5`）

**現実的には、500枚（200 MB）程度までなら全く問題ありません。**
