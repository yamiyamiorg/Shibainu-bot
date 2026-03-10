// src/services/shorten.js

function normalize(text) {
    if (!text) return '';
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripCodeBlocks(text) {
    // ``` ``` のコードブロックを除去（長文化しがちなので）
    return text.replace(/```[\s\S]*?```/g, '').trim();
}

function clampChars(text, maxChars) {
    if (text.length <= maxChars) return text;

    // 句点・改行あたりで気持ちよく切る
    const cut = text.slice(0, maxChars);

    // 優先: 最後の「。」「！」「？」 or 改行
    const idx = Math.max(
        cut.lastIndexOf('。'),
        cut.lastIndexOf('！'),
        cut.lastIndexOf('？'),
        cut.lastIndexOf('\n')
    );

    if (idx >= Math.floor(maxChars * 0.6)) {
        return cut.slice(0, idx + 1).trim();
    }
    return cut.trim() + '…';
}

function clampLines(text, maxLines) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length <= maxLines) return lines.join('\n');
    return lines.slice(0, maxLines).join('\n').trim();
}

/**
 * 返答を「短く・読みやすく・キャラ維持」に寄せる
 * - デフォルト: 8行、800文字
 * - 柔軟に調整可能
 */
function shortenReply(input, opts = {}) {
    const maxLines = opts.maxLines ?? 8;
    const maxChars = opts.maxChars ?? 800;

    let text = normalize(input);
    text = stripCodeBlocks(text);

    // 余計な先頭ラベル（例: "やみ:" "Assistant:"）が出たら消す
    text = text.replace(/^(assistant|yami|やみ|やみちゃん)\s*[:：]\s*/i, '').trim();

    // まず行数を整えてから文字数を整える（読みやすさ優先）
    text = clampLines(text, maxLines);
    text = clampChars(text, maxChars);

    // 最低限、空になったら保険
    if (!text) return '…むぎゅ。無言でもいいから、ここにいて🌙';

    return text;
}

module.exports = { shortenReply };
