// src/features/welcome/geminiService.js
const { generateText } = require('../../services/gemini');

const PROFILE_URL =
  'https://discord.com/channels/1450709451488100396/1462608428039016703';

function buildPrompt(username, userMessage) {
  return [
    'あなたはDiscordサーバーの「初心者歓迎担当」です。',
    'ユーザーの挨拶に対して、明るく優しく、短く歓迎してください。',
    '',
    '重要ルール:',
    '- 日本語',
    '- 2〜4行',
    '- 120〜260文字程度',
    '- フレンドリー',
    '- 次の一歩は必ず「プロフィールページへの案内」にすること',
    '- 「#自己紹介」などのチャンネル名は絶対に出さない',
    '',
    'プロフィールページは次のURLを必ず貼ること（改変しない）:',
    PROFILE_URL,
    '',
    `ユーザー名: ${username}`,
    `メッセージ: ${String(userMessage || '').trim()}`,
  ].join('\n');
}

async function generateWelcomeMessage(username, userMessage) {
  const prompt = buildPrompt(username, userMessage);

  try {
    const text = await generateText(prompt);
    const out = (text || '').trim();

    // 保険：AIがURLを貼らなかった/変な誘導をした場合は固定文にする
    if (!out.includes(PROFILE_URL) || out.includes('#自己紹介')) {
      return (
        `はじめまして、${username}さん！ようこそ〜🌸\n` +
        `まずはプロフィールページを見てみてね👇\n` +
        PROFILE_URL
      );
    }

    return out;
  } catch (err) {
    return (
      `はじめまして、${username}さん！ようこそ〜🌸\n` +
      `まずはプロフィールページを見てみてね👇\n` +
      PROFILE_URL
    );
  }
}

module.exports = { generateWelcomeMessage };
