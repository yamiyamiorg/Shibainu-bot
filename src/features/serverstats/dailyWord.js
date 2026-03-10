// src/features/serverstats/dailyWord.js
/**
 * 今日の一言
 *
 * 通常日: 曜日×時間帯×季節の静的パターンからランダム選択（Geminiなし）
 * 特別日: バレンタイン・ハロウィン・クリスマス・正月・祝日 → Geminiで生成
 *          （Gemini失敗時は静的パターンにフォールバック）
 *
 * ServerStatsのEmbedとは別メッセージとして同チャンネルに共存する。
 * メッセージIDはDBに保存し、毎朝editで上書きする。
 */

const { EmbedBuilder } = require('discord.js');
const { logger }       = require('../../services/logger');
const db               = require('./db');

// ─────────────────────────────────────────────
// 特別日の定義
// ─────────────────────────────────────────────

// MM-DD形式。祝日は主要なもののみ（固定日のみ、変動祝日は省略）
const SPECIAL_DAYS = {
    '01-01': { name: 'お正月',        emoji: '🎍', geminiHint: 'お正月の朝らしい一言' },
    '02-03': { name: '節分',          emoji: '👹', geminiHint: '節分らしい一言' },
    '02-14': { name: 'バレンタイン',  emoji: '🍫', geminiHint: 'バレンタインらしい一言' },
    '03-03': { name: 'ひな祭り',      emoji: '🎎', geminiHint: 'ひな祭りらしい一言' },
    '03-14': { name: 'ホワイトデー',  emoji: '🤍', geminiHint: 'ホワイトデーらしい一言' },
    '04-01': { name: 'エイプリルフール', emoji: '🃏', geminiHint: 'エイプリルフールっぽい嘘をひとつ（かわいく）' },
    '05-05': { name: 'こどもの日',    emoji: '🎏', geminiHint: 'こどもの日らしい一言' },
    '07-07': { name: '七夕',          emoji: '🎋', geminiHint: '七夕の夜らしい一言' },
    '07-20': { name: '夏休み',        emoji: '🌻', geminiHint: '夏休みが始まったような一言' },
    '08-11': { name: '山の日',        emoji: '🏔️', geminiHint: '山の日らしい一言' },
    '09-09': { name: '重陽の節句',    emoji: '🌸', geminiHint: '秋らしい一言' },
    '10-31': { name: 'ハロウィン',    emoji: '🎃', geminiHint: 'ハロウィンらしいちょっとこわかわいい一言' },
    '11-15': { name: '七五三',        emoji: '👘', geminiHint: '七五三らしい一言' },
    '12-24': { name: 'クリスマスイブ', emoji: '🎄', geminiHint: 'クリスマスイブらしい一言' },
    '12-25': { name: 'クリスマス',    emoji: '🎅', geminiHint: 'クリスマスらしい一言' },
    '12-31': { name: '大晦日',        emoji: '🎆', geminiHint: '大晦日らしい一言' },
};

// ─────────────────────────────────────────────
// 静的パターン（通常日用）
// ─────────────────────────────────────────────

// 朝（5-11時）・昼（11-17時）・夜（17-24時）・深夜（0-5時）の4帯
const PATTERNS = {
    morning: [
        'おはよーやみだよ🌙 今日もゆっくりでいいからね',
        'はろーぶぃぶぃ。朝ごはん食べた？やみは食べたよ（たぶん）',
        '今日の空、どんな感じ？やみはまだ外見てないけど☁️',
        'おはよ！今日もここにいるから、なんかあったら話しかけてね🩷',
        '朝から元気な人も、ぼーっとしてる人も、どっちもえらいよ',
        'やみだよ、今日もよろしくね。無理しないでいこ',
        '今日もがんばりすぎないでね。それだけで十分だよ🌸',
        '朝って地味につらいよね。やみもわかるよ',
    ],
    daytime: [
        'やみだよ🩷 今なにしてる？',
        'お昼すぎてるね。ご飯ちゃんと食べてる？',
        '今日どんな感じ？なんとなく話したいときはここにいるよ',
        'ひまなときも、忙しいときも、ここ覗いてくれてありがとう',
        'やみは今日もサーバーを見守ってるよ🌙 みんなのこと気にしてる',
        '午後もがんばってる人に、こっそり拍手してる🩷',
        'なんか疲れたなって思ったら、ちょっと休んでみて',
        '今日のサーバー、なんとなく穏やかな気がする☁️',
    ],
    evening: [
        'こんばんは🌙 今日もおつかれさまだよ',
        '夜になったね。今日どうだった？',
        'やみだよ。夜はちょっとさみしくなる時間だから、ここにいるね',
        '今日もいろいろあったと思う。ゆっくりしていってね🩷',
        '夜のサーバー、好きだよ。みんなの空気がやわらかくなる気がする',
        'お疲れ様でした、って言いたくなる夜だよ。今日もありがとう',
        '夕飯食べた？やみはスシが食べたいよ',
        '今夜も話したい人がいたらVC来てみてね。誰かいるかも🎤',
    ],
    latenight: [
        '深夜だね🌙 眠れない人いる？やみもいるよ',
        'こんな時間まで起きてるんだね。無理しないでね',
        '夜更かし仲間だよ。話したかったらいつでも',
        '深夜のサーバー、しーんとしてていいよね。やみは好きだよ',
        '眠れないときは、無理に寝なくていいよ。ここにいるから',
        '今日が終わりそうだね。お疲れさまでした🩷',
        '深夜に一人でいる人、やみが見てるよ。さみしくないよ',
        '明日のことは、明日考えよ。今夜はゆっくりしてね',
    ],
};

// 季節のフレーバーワード（3月-5月春、6月-8月夏、9月-11月秋、12月-2月冬）
const SEASON_FLAVOR = {
    spring: ['桜🌸', '春風', 'あったかくなってきた', '花粉がつらい人もいるよね'],
    summer: ['暑い日が続くね🌻', 'アイスが食べたい', '夏の夜はなんか特別だよね', '熱中症に気をつけてね'],
    autumn: ['秋めいてきたね🍂', '食欲の秋だよ', '夜が長くなってきた', '紅葉きれいだよね'],
    winter: ['寒くなってきたね❄️', '温かいもの飲んでる？', '冬の夜は長いね', 'ゆたんぽいいよね'],
};

function getSeason(month) {
    if (month >= 3 && month <= 5)  return 'spring';
    if (month >= 6 && month <= 8)  return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
}

function getTimeSlot(hour) {
    if (hour >= 5  && hour < 11) return 'morning';
    if (hour >= 11 && hour < 17) return 'daytime';
    if (hour >= 17 && hour < 24) return 'evening';
    return 'latenight';
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildStaticWord(jstDate) {
    const hour    = jstDate.getUTCHours();
    const month   = jstDate.getUTCMonth() + 1;
    const season  = getSeason(month);
    const slot    = getTimeSlot(hour);
    const base    = pickRandom(PATTERNS[slot]);
    // 30%確率で季節フレーバーを添える
    if (Math.random() < 0.3) {
        const flavor = pickRandom(SEASON_FLAVOR[season]);
        return `${base}　${flavor}`;
    }
    return base;
}

// ─────────────────────────────────────────────
// Geminiによる特別日生成
// ─────────────────────────────────────────────

async function buildSpecialWord(special) {
    try {
        const { generateText } = require('../../services/gemini');
        const prompt = `
あなたは「夜朝やみ」風の口調で話すDiscord Botです。
今日は「${special.name}」です。
${special.geminiHint}を、やみちゃんっぽい口調で1〜2行（50〜120文字）で書いてください。

条件:
- 若い女性のフレンドリーな話し方（SNSっぽい軽さ）
- 古風・威厳・魔王口調は禁止
- 絵文字を1〜2個だけ使ってもいい
- 「やみだよ」「だよ」「かな」「してみよ？」系の口調
- 説教しない、評価しない
`.trim();
        const text = await generateText(prompt);
        return text?.trim() || null;
    } catch {
        return null; // フォールバック
    }
}

// ─────────────────────────────────────────────
// メイン: 今日の一言を生成
// ─────────────────────────────────────────────

async function buildDailyWord() {
    const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
    const mmdd   = `${String(nowJst.getUTCMonth() + 1).padStart(2, '0')}-${String(nowJst.getUTCDate()).padStart(2, '0')}`;
    const special = SPECIAL_DAYS[mmdd];

    let text  = null;
    let emoji = '🌙';
    let label = '今日の一言';

    if (special) {
        emoji = special.emoji;
        label = `${special.name}の一言`;
        text  = await buildSpecialWord(special);
    }

    if (!text) {
        text = buildStaticWord(nowJst);
    }

    return { text, emoji, label };
}

// ─────────────────────────────────────────────
// Embed構築
// ─────────────────────────────────────────────

function buildDailyWordEmbed(text, emoji, label) {
    return new EmbedBuilder()
        .setColor(0xffb6c1)  // やみっぽいピンク
        .setTitle(`${emoji} ${label}`)
        .setDescription(text)
        .setTimestamp();
}

// ─────────────────────────────────────────────
// チャンネルへの投稿・更新（ServerStatsのEmbedと共存）
// ─────────────────────────────────────────────

async function findOldestDailyWordMessage(channel) {
    const botId = channel.client.user?.id;
    if (!botId) return null;

    let before = null;
    let oldest = null;

    while (true) {
        const options = before ? { limit: 100, before } : { limit: 100 };
        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        for (const [, msg] of messages) {
            if (msg.author?.id !== botId) continue;
            const title = msg?.embeds?.[0]?.title || '';
            if (!String(title).includes('今日の一言')) continue;
            if (!oldest || msg.createdTimestamp < oldest.createdTimestamp) oldest = msg;
        }

        before = messages.last()?.id || null;
        if (!before || messages.size < 100) break;
    }

    return oldest;
}

async function postOrUpdateDailyWord(channel, guildId, opts = {}) {
    try {
        const { text, emoji, label } = await buildDailyWord();
        const embed = buildDailyWordEmbed(text, emoji, label);
        const todayStr = getTodayJst();
        const payload = { embeds: [embed] };

        // DBからメッセージIDを取得
        const saved = await db.getDailyWordMessageId(guildId).catch(() => null);

        if (!saved?.message_id) {
            if (!opts.allowCreate) {
                logger.warn('dailyword.no_target', { guildId, channelId: channel.id });
                return;
            }
            // 初回send（initTarget経由のみ）
            const msg = await channel.send(payload);
            await db.saveDailyWordMessageId(guildId, channel.id, msg.id, todayStr);
            logger.info('dailyword.created', { guildId, messageId: msg.id });
            return;
        }

        try {
            const msg = await channel.messages.fetch(saved.message_id);
            await msg.edit(payload);
            if (saved.posted_date !== todayStr) {
                await db.saveDailyWordMessageId(guildId, channel.id, saved.message_id, todayStr);
            }
            logger.info('dailyword.updated', { guildId, messageId: saved.message_id });
        } catch (err) {
            // edit失敗 = メッセージが消えた → DBクリアして次回initで再補完
            logger.warn('dailyword.edit_failed_clearing', {
                guildId, channelId: channel.id, messageId: saved.message_id, err: err?.message,
            });
            await db.clearDailyWordMessageId(guildId).catch(() => { });
        }
    } catch (err) {
        logger.error('dailyword.error', { guildId, err: err?.message });
    }
}

function getTodayJst() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

module.exports = { postOrUpdateDailyWord };
