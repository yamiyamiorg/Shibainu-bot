// src/commands/yami.js
const { generateText } = require('../services/gemini');
const { buildPrompt, fallbackReply } = require('../services/yamiPersona');
const { shortenReply } = require('../services/shorten');
const { upsertUser } = require('../db/userRepo');
const { addTurn, getRecentTurns } = require('../db/turnRepo');
const { logger } = require('../services/logger');

const {
    detectRisk,
    buildCrisisReply,
    buildDistressPrefix,
    detectCrisisAnswer,
    buildCrisisFollowupNo,
    buildCrisisFollowupUnknown,
} = require('../safety/risk');

const {
    getConversationState,
    setConversationHint,
    clearConversationHint,
} = require('../db/conversationRepo');

// --- rate limit (in-memory) ---
const COOLDOWN_SECONDS = Number(process.env.COOLDOWN_SECONDS || 15);
const cooldownMap = new Map(); // key: `${guildKey}:${userId}` -> lastTimeMs

function isCoolingDown({ guildKey, userId }) {
    const key = `${guildKey}:${userId}`;
    const now = Date.now();
    const last = cooldownMap.get(key) || 0;
    const diff = now - last;

    if (diff < COOLDOWN_SECONDS * 1000) {
        const remain = Math.ceil((COOLDOWN_SECONDS * 1000 - diff) / 1000);
        return { blocked: true, remain };
    }

    cooldownMap.set(key, now);
    return { blocked: false, remain: 0 };
}

// --- guild-wide rate limit (fixed 60s window) ---
const GUILD_RPM_LIMIT = Number(process.env.GUILD_RPM_LIMIT || 60);
// key: guildKey -> { windowStartMs, count }
const guildWindowMap = new Map();

function checkGuildLimit({ guildKey }) {
    const now = Date.now();
    const WINDOW_MS = 60 * 1000;

    const cur = guildWindowMap.get(guildKey);
    if (!cur || now - cur.windowStartMs >= WINDOW_MS) {
        guildWindowMap.set(guildKey, { windowStartMs: now, count: 1 });
        return { blocked: false, remainSec: 0, limit: GUILD_RPM_LIMIT, count: 1 };
    }

    if (cur.count >= GUILD_RPM_LIMIT) {
        const remainSec = Math.ceil((WINDOW_MS - (now - cur.windowStartMs)) / 1000);
        return { blocked: true, remainSec, limit: GUILD_RPM_LIMIT, count: cur.count };
    }

    cur.count += 1;
    return { blocked: false, remainSec: 0, limit: GUILD_RPM_LIMIT, count: cur.count };
}

const CRISIS_PENDING = '__CRISIS_PENDING__';
const CRISIS_ACTION = '__CRISIS_ACTION__';

function nowSec() {
    return Math.floor(Date.now() / 1000);
}

function looksLikeGeneralQuestion(text) {
    return /(\?|？|教えて|おすすめ|何が|どれが|一番|ランキング|攻略|期待値|イベント|盛り上がる|アイデア|企画|人気|方法|どうやる|コツ)/.test(
        text
    );
}

function looksLikePhysicalSymptom(text) {
    return /(下痢|腹痛|吐き気|嘔吐|発熱|熱|頭痛|咳|喉|口内炎|口内|副作用|薬|くすり|痛い|めまい|だるい)/.test(
        text
    );
}

// ✅ ここが共通の中身（両方これを呼ぶ）
async function handleYamiCore({ dbPath, guildKey, userId, userText, requestId }) {
    const text = (userText || '').trim() || '無言でもいい？';

    // requestId が未指定でも落ちないように
    const rid = requestId || 'na';

    logger.debug('yami.in', {
        requestId: rid,
        guildKey,
        userId,
        textPreview: text.slice(0, 80),
    });

    const { nicknameMode } = await upsertUser({ dbPath, userId, guildId: guildKey });
    const lastHint = await getConversationState({ dbPath, userId, guildId: guildKey });

    // --- 危機対応（保存・memoryなし） ---
    if (lastHint === CRISIS_PENDING) {
        const ans = detectCrisisAnswer(text);
        logger.info('yami.crisis.pending', { requestId: rid, guildKey, userId, ans });

        if (ans === 'yes') {
            await setConversationHint({ dbPath, userId, guildId: guildKey, hint: CRISIS_ACTION });
            return shortenReply(buildCrisisReply({ nicknameMode }), { maxLines: 4, maxChars: 360 });
        }

        if (ans === 'no') {
            await clearConversationHint({ dbPath, userId, guildId: guildKey });
            return shortenReply(buildCrisisFollowupNo({ nicknameMode }), { maxLines: 4, maxChars: 320 });
        }

        return shortenReply(buildCrisisFollowupUnknown({ nicknameMode }), { maxLines: 4, maxChars: 320 });
    }

    // 「電話した/できない」までで終了する仕様
    if (lastHint === CRISIS_ACTION) {
        logger.info('yami.crisis.action_end', { requestId: rid, guildKey, userId });
        await clearConversationHint({ dbPath, userId, guildId: guildKey });
        return shortenReply(buildCrisisFollowupNo({ nicknameMode }), { maxLines: 4, maxChars: 320 });
    }

    // --- 危険判定（ここは1回） ---
    const risk = detectRisk(text);
    logger.info('yami.risk', { requestId: rid, guildKey, userId, level: risk.level });

    // high：Gemini呼ばない＋危機フラグ（安全最優先）
    if (risk.level === 'high') {
        await setConversationHint({ dbPath, userId, guildId: guildKey, hint: CRISIS_PENDING });
        logger.warn('yami.crisis.enter', { requestId: rid, guildKey, userId });
        return shortenReply(buildCrisisReply({ nicknameMode }), { maxLines: 4, maxChars: 360 });
    }

    // --- レート制限（high以外に適用） ---
    const gl = checkGuildLimit({ guildKey });
    if (gl.blocked) {
        logger.warn('yami.limit.guild', {
            requestId: rid,
            guildKey,
            userId,
            remainSec: gl.remainSec,
            count: gl.count,
            limit: gl.limit,
        });
        const call = nicknameMode ? 'ぴえんども' : 'きみ';
        return `いまちょっと混んでる…🌙 ${call}、${gl.remainSec}秒だけ待ってて。`;
    }

    const cd = isCoolingDown({ guildKey, userId });
    if (cd.blocked) {
        logger.warn('yami.limit.user', { requestId: rid, guildKey, userId, remainSec: cd.remain });
        const call = nicknameMode ? 'ぴえんども' : 'きみ';
        return `ちょい待ってね、${call}…🌙（あと${cd.remain}秒）`;
    }

    // --- 雑談/質問/体調っぽさ判定（テンプレ化防止） ---
    const isQ = looksLikeGeneralQuestion(text);
    const isPhysical = looksLikePhysicalSymptom(text);

    // mediumでも、雑談質問 or 体調っぽいなら “ケア前置き” を付けない
    const prefix =
        risk.level === 'medium' && !isQ && !isPhysical ? buildDistressPrefix({ nicknameMode }) : '';

    // 2回に1回だけ memory（軽量）
    const useMemory = nowSec() % 2 === 0;
    const recentTurns = useMemory ? await getRecentTurns({ dbPath, userId, guildId: guildKey }) : [];

    logger.debug('yami.prompt', {
        requestId: rid,
        guildKey,
        userId,
        risk: risk.level,
        isQuestion: isQ,
        isPhysical,
        prefixOn: !!prefix,
        useMemory,
        memoryTurns: recentTurns.length,
    });

    const prompt = buildPrompt({
        userText: prefix ? `${prefix}\n\n${text}` : text,
        nicknameMode,
        recentTurns,
    });

    try {
        // 保存（通常会話だけ）
        await addTurn({ dbPath, userId, guildId: guildKey, role: 'user', content: text });

        const reply = await generateText(prompt);
        const out = shortenReply(reply || fallbackReply(), { maxLines: 4, maxChars: 280 });

        await addTurn({ dbPath, userId, guildId: guildKey, role: 'bot', content: out });

        logger.info('yami.ok', { requestId: rid, guildKey, userId, outChars: out.length });

        return out;
    } catch (e) {
        logger.error('yami.error', {
            requestId: rid,
            guildKey,
            userId,
            err: e?.message,
            stack: e?.stack,
        });
        return shortenReply(fallbackReply(), { maxLines: 4, maxChars: 280 });
    }
}

// ✅ スラッシュコマンド用
async function handleYamiCommand(interaction, { dbPath, requestId } = {}) {
    const userText = interaction.options.getString('text') || '無言でもいい？';
    const guildKey = interaction.guildId ?? interaction.channelId ?? 'DM';
    const userId = interaction.user.id;

    return handleYamiCore({ dbPath, guildKey, userId, userText, requestId });
}

// ✅ テキスト（リプライ）用
async function handleYamiText({ dbPath, guildKey, userId, userText, requestId }) {
    return handleYamiCore({ dbPath, guildKey, userId, userText, requestId });
}

module.exports = { handleYamiCommand, handleYamiText };
