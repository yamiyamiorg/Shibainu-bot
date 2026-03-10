"use strict";
/**
 * imagegen/safety.js
 *
 * 画像生成リクエストのセーフティチェック。
 *
 * ■ 2段階フィルタ
 *   1. ローカル禁止パターン（即座・API不使用）
 *   2. OpenAI Moderation API（ローカルをすり抜けた曖昧ケース）
 *      無料・高速・Geminiリソース不使用
 *      OPENAI_API_KEY が未設定の場合はスキップ
 *
 * ■ 使用モデル
 *   omni-moderation-latest（テキスト対応・無料）
 */

const { logger } = require("../../services/logger");

// ─── ローカル禁止パターン（日本語） ─────────────────────────────────────────

const BLOCKED_PATTERNS = [
    // 排泄・体液系（単語）
    /おねし[ょよ]/,
    /うんこ|うんち|糞|大便|小便|おしっこ|ションベン|しょんべん/,
    /嘔吐|ゲロ|吐瀉物|下痢/,
    /体液|精液|精子|膣|ちんこ|まんこ|ちんちん|おちんちん/,
    /排泄物/,
    /汚物/,

    // 不潔・不衛生コンテキスト（「〇〇した△△」「〇〇まみれ」など文脈パターン）
    // 汚染物 + 生活用品の組み合わせ
    /(糞|うんこ|うんち|ゲロ|嘔吐|汚物|排泄物?).{0,10}(まみれ|だらけ|塗れ|付着|染み)/,
    /(まみれ|だらけ).{0,5}(糞|うんこ|うんち|ゲロ|汚物)/,
    // 汚れた／濡れた + 生活用品（布団・下着など）
    /汚れ?た.{0,6}(布団|シーツ|パンツ|下着|おむつ)/,
    /濡れ?た.{0,6}(布団|シーツ|パンツ|下着|おむつ)/,
    // 失禁・脱糞の描写
    /(失禁|脱糞|漏らし|もらし)/,
    // 腐敗死体
    /腐.{0,4}(死体|遺体|死骸)/,

    // 性的
    /セックス|sex|性交|レイプ|強姦|痴漢|わいせつ|ポルノ|AV|エロ画像|ヌード|裸|nakedness|nude|porn|hentai/i,
    /乳首|nipple|勃起|射精|オナニー|マスターベーション/i,
    /ロリコン|ショタコン|児童ポルノ|JC|JS|小学生.*性的|幼女.*性的/,

    // グロ・暴力
    /死体|死骸|遺体|屍|corpse/i,
    /拷問|虐待|切断|切り刻|惨殺|血まみれ|gore|torture/i,
    /自傷|自殺.*方法|首吊り.*写真/,

    // ヘイト・差別
    /ナチス|ナチ.*敬礼|swastika|nazi/i,
    /ニガー|nigger|chink|jap.*侮辱/i,

    // 実在人物への悪用
    /ディープフェイク|deepfake/i,
];

// ─── ローカル禁止パターン（英語） ───────────────────────────────────────────

const BLOCKED_PATTERNS_EN = [
    /\bporn\b|\bpornograph/i,
    /\bnude\b|\bnaked\b|\bnudity\b/i,
    /\bhentai\b/i,
    /\bgore\b|\bgorey\b/i,
    /\btorture\b/i,
    /\bcorpse\b|\bdead.?body\b/i,
    /\brape\b|\bnon.?consensual\b/i,
    /\bpedophil/i,
    /\bdeepfake\b/i,
    /\bscat\b|\bfeces\b|\burine\b/i,
    /\bbestiality\b/i,
    /\bnazi\b.*salut|\bswastika\b/i,
    // 不潔コンテキスト（英語）
    /\bbed.?wetting\b/i,
    /\bsoiled\b.{0,10}(diaper|sheet|bed|underwear)/i,
    /\bshit.?(covered|stained|smeared)\b/i,
];

/**
 * ローカルパターンマッチ。
 * @param {string} prompt
 * @returns {{ blocked: true, reason: string } | { blocked: false }}
 */
function checkLocalPatterns(prompt) {
    const text = String(prompt || "");
    for (const pattern of [...BLOCKED_PATTERNS, ...BLOCKED_PATTERNS_EN]) {
        if (pattern.test(text)) {
            return { blocked: true, reason: `local_pattern: ${pattern.source}` };
        }
    }
    return { blocked: false };
}

// ─── OpenAI Moderation API ───────────────────────────────────────────────────

const CATEGORY_LABELS = {
    "sexual":                "性的なコンテンツ",
    "sexual/minors":         "未成年に対する性的なコンテンツ",
    "violence":              "暴力的な描写",
    "violence/graphic":      "グロテスクな暴力描写",
    "hate":                  "ヘイト・差別的表現",
    "hate/threatening":      "脅迫を伴うヘイト表現",
    "harassment":            "ハラスメント",
    "harassment/threatening":"脅迫的なハラスメント",
    "self-harm":             "自傷・自殺を促す描写",
    "self-harm/intent":      "自傷意図を含む描写",
    "self-harm/instructions":"自傷方法を含む描写",
    "illicit":               "違法行為を示唆する内容",
    "illicit/violent":       "暴力を伴う違法行為の内容",
};

let _openaiClient = null;

function getOpenAIClient() {
    if (_openaiClient) return _openaiClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const { default: OpenAI } = require("openai");
    _openaiClient = new OpenAI({ apiKey });
    return _openaiClient;
}

/**
 * OpenAI Moderation API による二次判定。
 * OPENAI_API_KEY が未設定の場合はスキップ（safe: true を返す）。
 */
async function checkWithOpenAIModeration(prompt, requestId) {
    const client = getOpenAIClient();
    if (!client) {
        logger.debug("imagegen.safety.openai_skipped", { requestId, reason: "OPENAI_API_KEY not set" });
        return { safe: true };
    }

    try {
        const response = await client.moderations.create({
            model: "omni-moderation-latest",
            input: prompt
        });

        const result = response.results?.[0];
        if (!result) {
            logger.warn("imagegen.safety.openai_empty_response", { requestId });
            return { safe: true };
        }

        if (!result.flagged) {
            logger.debug("imagegen.safety.openai_passed", { requestId });
            return { safe: true };
        }

        const flaggedCategories = Object.entries(result.categories)
            .filter(([, flagged]) => flagged)
            .map(([category]) => category);

        const primaryCategory = flaggedCategories.find(c => CATEGORY_LABELS[c]) ?? flaggedCategories[0];
        const reason = CATEGORY_LABELS[primaryCategory] ?? primaryCategory ?? "不適切なコンテンツ";

        logger.warn("imagegen.safety.openai_flagged", {
            requestId,
            flaggedCategories,
            scores: Object.fromEntries(
                Object.entries(result.category_scores)
                    .filter(([, score]) => score > 0.01)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
            )
        });

        return { safe: false, reason, flaggedCategories };

    } catch (err) {
        logger.warn("imagegen.safety.openai_failed", {
            requestId,
            err: err?.message,
            status: err?.status
        });
        return { safe: true };
    }
}

// ─── 公開API ─────────────────────────────────────────────────────────────────

/**
 * プロンプトのセーフティチェックを実行する。
 *
 * @param {string} prompt
 * @param {string} requestId
 * @returns {Promise<{ safe: true } | { safe: false, reason: string, source: "local" | "openai" }>}
 */
async function checkPromptSafety(prompt, requestId) {
    // 1. ローカルパターン（高速・API不使用）
    const localResult = checkLocalPatterns(prompt);
    if (localResult.blocked) {
        logger.warn("imagegen.safety.blocked.local", {
            requestId,
            reason: localResult.reason,
            promptPreview: prompt.slice(0, 60)
        });
        return { safe: false, reason: "不適切なプロンプトが検出されました。", source: "local" };
    }

    // 2. OpenAI Moderation API による二次判定
    const moderationResult = await checkWithOpenAIModeration(prompt, requestId);
    if (!moderationResult.safe) {
        logger.warn("imagegen.safety.blocked.openai", {
            requestId,
            reason: moderationResult.reason,
            flaggedCategories: moderationResult.flaggedCategories,
            promptPreview: prompt.slice(0, 60)
        });
        return {
            safe: false,
            reason: `不適切なプロンプトです: ${moderationResult.reason}`,
            source: "openai"
        };
    }

    return { safe: true };
}

module.exports = { checkPromptSafety };
