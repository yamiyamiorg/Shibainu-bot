// src/features/diary-reaction/geminiService.js
/**
 * 日記の内容からGeminiに絵文字を選ばせる
 */

const { generateText, GeminiDisabledError, GeminiQuotaError } = require('../../services/gemini');
const { logger } = require('../../services/logger');

// 絵文字のみを抽出する正規表現（Unicode絵文字全般）
// \p{Emoji} だと英数字もマッチするため、より限定的なパターンを使う
const EMOJI_REGEX = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;

/**
 * 日記テキストを受け取り、絵文字の配列を返す
 * @param {string} content - 日記の本文
 * @param {number} count   - 取得する絵文字の数
 * @returns {Promise<string[]>} 絵文字の配列（失敗時は空配列）
 */
async function selectEmojisForDiary(content, count = 3) {
    const prompt = buildPrompt(content, count);

    try {
        const raw = await generateText(prompt);
        const emojis = parseEmojis(raw, count);

        logger.info('diary-reaction.gemini.success', {
            rawResponse: raw,
            parsedEmojis: emojis,
        });

        return emojis;
    } catch (err) {
        if (err instanceof GeminiDisabledError) {
            logger.warn('diary-reaction.gemini.disabled');
        } else if (err instanceof GeminiQuotaError) {
            logger.warn('diary-reaction.gemini.quota_exceeded');
        } else {
            logger.error('diary-reaction.gemini.error', { err: err?.message });
        }
        return [];
    }
}

/**
 * Geminiに送るプロンプトを組み立てる
 */
function buildPrompt(content, count) {
    // ぬくもり機能のホワイトリスト絵文字（これらはあちら側が使うので被せない）
    const nukumoriEmojis = '❤️ 💚 🫶 🤝 🌱 🪽';

    return [
        `以下は、あるユーザーが書いたプライベートな日記の投稿です。`,
        `この内容の雰囲気や感情にぴったり合う絵文字を${count}つだけ選んでください。`,
        ``,
        `【出力ルール】`,
        `- 絵文字のみを出力してください（説明・テキスト・記号は一切不要）`,
        `- 半角スペース区切りで1行に並べてください`,
        `- 例: 🌙 💬 🫂`,
        `- ネガティブな内容でも、受け止める・寄り添う絵文字を選んでください`,
        `- ハートや応援の絵文字だけに偏らず、内容に合った多様な絵文字を選んでください`,
        `- 以下の絵文字は使用禁止です（他の機能で使用中）: ${nukumoriEmojis}`,
        ``,
        `【日記の内容】`,
        content,
    ].join('\n');
}

/**
 * Geminiの返答から絵文字だけを抽出する
 */
function parseEmojis(raw, count) {
    const matches = raw.match(EMOJI_REGEX) || [];

    // 重複を除去して指定数を返す
    const unique = [...new Set(matches)];
    return unique.slice(0, count);
}

module.exports = { selectEmojisForDiary };
