// src/features/serverstats/keywordExtractor.js
/**
 * 簡易キーワード抽出（形態素解析なし）
 *
 * 方針:
 *  - URL・メンション・絵文字・記号を除去
 *  - 日本語は2文字以上の名詞的なかたまりを抽出（スペース・句読点区切り）
 *  - 英語は3文字以上の単語を対象
 *  - ストップワード（よく使うが意味の薄い語）を除外
 *  - 出現頻度でソートして上位を返す
 */

// 日本語ストップワード（よく使うが意味の薄い語）
const JP_STOPWORDS = new Set([
    'です', 'ます', 'した', 'して', 'から', 'ので', 'ない', 'ある', 'いる',
    'なる', 'れる', 'られ', 'なん', 'って', 'けど', 'でも', 'だけ', 'とか',
    'みたい', 'ちょっと', 'すごい', 'やっぱ', 'やっぱり', 'なんか', 'なんで',
    'もう', 'また', 'まあ', 'そう', 'こう', 'どう', 'いい', 'よい', 'ほど',
    'ため', 'とき', 'こと', 'もの', 'ところ', 'さん', 'くん', 'ちゃん',
    'これ', 'それ', 'あれ', 'この', 'その', 'あの', 'ここ', 'そこ', 'あそこ',
    'わたし', 'ぼく', 'おれ', 'あたし', 'うち', 'きみ', 'あなた',
    'https', 'http', 'www',
    // 複合語の末尾に付いてノイズになりやすい語
    '楽し', '終わっ', '終わ', '高かっ', '高い', '使っ', '作っ', '入ろ',
]);

// 英語ストップワード
const EN_STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
    'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
    'how', 'its', 'may', 'now', 'old', 'see', 'two', 'way', 'who', 'did',
    'its', 'let', 'put', 'say', 'she', 'too', 'use', 'have', 'that', 'this',
    'with', 'from', 'they', 'know', 'want', 'been', 'good', 'much', 'some',
    'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long', 'make',
    'than', 'then', 'them', 'well', 'were',
]);

/**
 * テキストからキーワードを抽出する
 * @param {string} text - 複数メッセージをまとめた文字列
 * @param {number} topN - 返す上位件数
 * @returns {{ word: string, count: number }[]}
 */
function extractKeywords(text, topN = 10) {
    if (!text || text.trim().length === 0) return [];

    // 前処理
    const cleaned = text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/<@!?\d+>/g, '')
        .replace(/<#\d+>/g, '')
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
        .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .toLowerCase();

    const freq = new Map();

    // ── 日本語：カタカナ語・漢字語を独立して抽出 ──
    // カタカナ2文字以上の塊と、漢字2文字以上の塊をそれぞれ取り出す
    // 例: 「深夜テンションすごい」→「深夜」「テンション」が個別に取れる

    // カタカナ語（2文字以上）
    const katakanaMatches = cleaned.match(/[\u30A0-\u30FF]{2,}/g) || [];
    for (const word of katakanaMatches) {
        if (JP_STOPWORDS.has(word) || word.length < 2) continue;
        freq.set(word, (freq.get(word) ?? 0) + 1);
    }

    // 漢字語（2文字以上）
    const kanjiMatches = cleaned.match(/[\u4E00-\u9FFF]{2,}/g) || [];
    for (const word of kanjiMatches) {
        if (JP_STOPWORDS.has(word) || word.length < 2) continue;
        freq.set(word, (freq.get(word) ?? 0) + 1);
    }

    // 漢字＋カタカナの複合語（「深夜テンション」「作業通話」のような形）
    // 漢字とカタカナが混在する語のみを対象にする（純漢字・純カタカナは上で取得済み）
    const compositeMatches = cleaned.match(/(?:[\u4E00-\u9FFF]+[\u30A0-\u30FF]+|[\u30A0-\u30FF]+[\u4E00-\u9FFF]+){1}[\u4E00-\u9FFF\u30A0-\u30FF]*/g) || [];
    for (const word of compositeMatches) {
        if (JP_STOPWORDS.has(word) || word.length < 3) continue;
        // 純漢字・純カタカナに変換できる語は単体で取れているのでスキップ
        if (/^[\u4E00-\u9FFF]+$/.test(word)) continue;
        if (/^[\u30A0-\u30FF]+$/.test(word)) continue;
        freq.set(word, (freq.get(word) ?? 0) + 1);
    }

    // ── ポストフィルタ: 末尾がひらがな混じりのノイズ語を除去 ──
    for (const [word] of [...freq.entries()]) {
        if (/[\u3040-\u309F]/.test(word)) {
            freq.delete(word);
        }
    }

    // ── 英語：3文字以上の単語 ──
    const enMatches = cleaned.match(/[a-z]{3,}/g) || [];
    for (const word of enMatches) {
        if (EN_STOPWORDS.has(word)) continue;
        freq.set(word, (freq.get(word) ?? 0) + 1);
    }

    // 頻度順ソート・2回以上出現した語のみ・上位N件
    return [...freq.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([word, count]) => ({ word, count }));
}

module.exports = { extractKeywords };
