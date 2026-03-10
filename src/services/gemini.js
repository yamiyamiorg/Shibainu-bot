// src/services/gemini.js
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

class GeminiDisabledError extends Error {
    constructor(message = 'Gemini is disabled') {
        super(message);
        this.name = 'GeminiDisabledError';
    }
}

class GeminiQuotaError extends Error {
    constructor(message = 'Gemini quota/limit reached') {
        super(message);
        this.name = 'GeminiQuotaError';
    }
}

// 一時的なAPIエラー（リトライ対象）
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function isRetryable(err) {
    const status = Number(err?.status || err?.code || 0);
    if (RETRYABLE_STATUSES.has(status)) return true;
    // ApiError はメッセージにJSONが埋め込まれる場合がある
    const msg = String(err?.message || '');
    const codeMatch = msg.match(/"code"\s*:\s*(\d+)/);
    return codeMatch ? RETRYABLE_STATUSES.has(Number(codeMatch[1])) : false;
}

// ---- in-memory daily limiter ----
let dayKey = '';
let usedToday = 0;

function getDayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function ensureDay() {
    const today = getDayKey();
    if (dayKey !== today) { dayKey = today; usedToday = 0; }
}

function checkDailyLimit() {
    const limit = Number(process.env.GEMINI_DAILY_LIMIT || 0);
    ensureDay();
    if (limit > 0 && usedToday >= limit) return { blocked: true, limit, used: usedToday };
    return { blocked: false, limit, used: usedToday };
}

function markUsed() { ensureDay(); usedToday += 1; }

function isEnabled() {
    const v = String(process.env.GEMINI_ENABLED ?? '1').trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'off';
}

function makeClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new GeminiDisabledError('GEMINI_API_KEY is missing');
    return new GoogleGenAI({ apiKey });
}

function logUsage({ model, ok, reason, limitInfo, usage }) {
    const parts = [
        `[gemini] ${ok ? 'OK' : 'NG'}`,
        `model=${model || '-'}`,
        `date=${dayKey || getDayKey()}`,
        `count=${usedToday}${limitInfo?.limit ? `/${limitInfo.limit}` : ''}`,
    ];
    if (reason) parts.push(`reason=${reason}`);
    if (usage)  parts.push(`usage=${JSON.stringify(usage)}`);
    console.log(parts.join(' '));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Gemini にテキスト生成を依頼する
 *
 * maxRetries=3 → 最大4回試行（初回 + リトライ3回）
 * 待機: 2s → 4s → 8s (exponential backoff)
 * 503/429 等の一時的エラーはリトライ後 GeminiQuotaError に変換
 * → reporter.js のフォールバックが必ず動く
 */
async function generateText(prompt, { maxRetries = 3 } = {}) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (!isEnabled()) {
        ensureDay();
        logUsage({ model, ok: false, reason: 'disabled', limitInfo: checkDailyLimit() });
        throw new GeminiDisabledError('Gemini disabled by GEMINI_ENABLED');
    }

    const dl = checkDailyLimit();
    if (dl.blocked) {
        logUsage({ model, ok: false, reason: `daily_limit(${dl.used}/${dl.limit})`, limitInfo: dl });
        throw new GeminiQuotaError(`Daily limit reached: ${dl.used}/${dl.limit}`);
    }

    const ai = makeClient();
    let lastErr = null;
    const totalAttempts = maxRetries + 1; // 例: maxRetries=3 → 4回試行

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
        // 2回目以降はバックオフ待機
        if (attempt > 0) {
            const wait = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
            logUsage({ model, ok: false, reason: `retry(${attempt}/${maxRetries}) waiting=${wait}ms`, limitInfo: checkDailyLimit() });
            await sleep(wait);
        }

        try {
            const result = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8,
                    topP: 0.9,
                    maxOutputTokens: 220,
                },
            });

            const text =
                result?.candidates?.[0]?.content?.parts
                    ?.map(p => p.text)
                    .filter(Boolean)
                    .join('') || '';

            markUsed();
            const usage = result?.usageMetadata || result?.usage || null;
            logUsage({ model, ok: true, limitInfo: checkDailyLimit(), usage });
            return text.trim();

        } catch (e) {
            lastErr = e;
            ensureDay();
            const codeFromMsg = String(e?.message || '').match(/"code"\s*:\s*(\d+)/)?.[1];
            const status = e?.status || e?.code || codeFromMsg || '?';

            const retryable = isRetryable(e);
            const hasMore = attempt < totalAttempts - 1;

            if (retryable && hasMore) {
                logUsage({ model, ok: false, reason: `api_error(${status}) will_retry`, limitInfo: checkDailyLimit() });
                continue; // 次のループへ
            }

            // 最終失敗
            logUsage({ model, ok: false, reason: `api_error(${status}) giving_up`, limitInfo: checkDailyLimit() });

            if (retryable) {
                // 一時的エラー → フォールバック発動のため GeminiQuotaError に変換
                throw new GeminiQuotaError(`Gemini temporarily unavailable (${status}) after ${totalAttempts} attempts`);
            }

            throw e; // 認証失敗等の恒久的エラーはそのままスロー
        }
    }

    // ここには到達しない
    throw new GeminiQuotaError(`Gemini failed: ${lastErr?.message}`);
}

module.exports = { generateText, GeminiDisabledError, GeminiQuotaError };
