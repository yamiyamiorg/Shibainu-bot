"use strict";
/**
 * imagegen/index.js
 *
 * Discord スラッシュコマンド /img の処理。
 *
 * ■ キュー設計
 *   - 同時実行は1ジョブのみ（GPUは1枚想定）
 *   - キュー上限: IMG_QUEUE_MAX（デフォルト 4）
 *   - ユーザー単位クールダウン: IMG_COOLDOWN_MS（デフォルト 20000ms）
 *   - 同一ユーザーがキューに重複エントリ不可
 *   - キュー待ち中はエフェメラルメッセージで「〇番目に並んでます」を通知
 *   - タイムアウト: IMG_QUEUE_TIMEOUT_MS（デフォルト 300000ms = 5分）
 *
 * ■ セーフティ
 *   - ローカル禁止パターン（safety.js）+ OpenAI Moderation API 二次判定
 *   - 違反累積BAN（violations.js）
 *   - 自動削除: IMG_AUTO_DELETE_SEC 秒後に生成画像を自動削除（未設定なら永続）
 */

const { AttachmentBuilder } = require("discord.js");
const { logger } = require("../../services/logger");
const { isFeatureEnabled } = require("../../utils/featureConfig");
const { generateText } = require("../../services/gemini");
const { openDb } = require("../../db/sqlite");
const { checkPromptSafety } = require("./safety");
const {
    migrateViolations,
    checkBan,
    recordViolation,
    notifyModerator,
    getViolationInfo,
    resetViolation,
    setBan
} = require("./violations");

const FEATURE_NAME = "imagegen";
const JP_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/;

const STYLE_TEXT = {
    portrait: "portrait-focused",
    animal: "animal-focused",
    illustration: "illustration style",
    anime: "anime style",
    photorealistic: "photorealistic style",
    cinematic: "cinematic style"
};

// ─── ユーティリティ ────────────────────────────────────────────────────────

function normalizePrompt(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function containsJapanese(text) {
    return JP_REGEX.test(text);
}

function buildPresetPrompt({ style, main, scene }) {
    const styleText = STYLE_TEXT[style] || "photorealistic style";
    const subject = normalizePrompt(main);
    const situation = normalizePrompt(scene);

    let sentence = `Create a ${styleText} image featuring ${subject}.`;
    if (situation) {
        sentence += ` The scene should depict ${situation}.`;
    }
    sentence += " Use natural lighting, strong composition, and clear details.";
    return sentence;
}

async function translateJapanesePrompt(prompt, requestId) {
    const translationEnabled =
        String(process.env.IMG_PROMPT_TRANSLATE ?? "true").toLowerCase() !== "false";
    if (!translationEnabled || !containsJapanese(prompt)) {
        return { prompt, translated: false };
    }

    const instruction = [
        "Translate the following Japanese image prompt into natural English for FLUX.1 schnell.",
        "Keep key style words and nouns accurate.",
        "Output only one English prompt sentence without quotes or markdown.",
        `Japanese prompt: ${prompt}`
    ].join("\n");

    try {
        const translated = normalizePrompt(await generateText(instruction, { maxRetries: 1 }));
        if (!translated) {
            return { prompt, translated: false };
        }
        logger.info("imagegen.prompt.translated", {
            requestId,
            originalLength: prompt.length,
            translatedLength: translated.length
        });
        return { prompt: translated, translated: true, originalPrompt: prompt };
    } catch (err) {
        logger.warn("imagegen.prompt.translate_failed", {
            requestId,
            err: err?.message
        });
        return { prompt, translated: false };
    }
}

// ─── キューマネージャー ─────────────────────────────────────────────────────

class ImageGenQueue {
    constructor() {
        this._queue = [];
        this._running = false;
        this._maxSize = Number(process.env.IMG_QUEUE_MAX) || 4;
        this._queueTimeoutMs = Number(process.env.IMG_QUEUE_TIMEOUT_MS) || 300_000;
    }

    _userIds() {
        return new Set(this._queue.map(e => e.userId));
    }

    enqueue(userId, requestId, run) {
        if (this._userIds().has(userId)) {
            return { ok: false, reason: "already_queued" };
        }
        if (this._queue.length >= this._maxSize) {
            return { ok: false, reason: "queue_full" };
        }

        const timeoutId = setTimeout(() => {
            const idx = this._queue.findIndex(e => e.userId === userId);
            if (idx > 0) {
                this._queue.splice(idx, 1);
                logger.warn("imagegen.queue.entry_timeout", { requestId, userId });
            }
        }, this._queueTimeoutMs);

        this._queue.push({ userId, requestId, run, timeoutId });

        const position = this._queue.length;
        logger.info("imagegen.queue.enqueued", {
            requestId, userId,
            queueLength: this._queue.length,
            position
        });

        setImmediate(() => this._tick());
        return { ok: true, position };
    }

    async _tick() {
        if (this._running || this._queue.length === 0) return;
        this._running = true;

        const entry = this._queue[0];
        clearTimeout(entry.timeoutId);

        logger.info("imagegen.queue.job_start", {
            requestId: entry.requestId,
            userId: entry.userId,
            remainingQueue: this._queue.length - 1
        });

        try {
            await entry.run();
        } catch (err) {
            logger.error("imagegen.queue.job_unhandled_error", {
                requestId: entry.requestId,
                err: err?.message
            });
        } finally {
            this._queue.shift();
            this._running = false;
            logger.info("imagegen.queue.job_done", {
                requestId: entry.requestId,
                remainingQueue: this._queue.length
            });
            setImmediate(() => this._tick());
        }
    }

    get size() { return this._queue.length; }
    get isRunning() { return this._running; }
}

// ─── ユーザー単位クールダウン ───────────────────────────────────────────────

class CooldownManager {
    constructor() {
        this._map = new Map();
    }

    check(userId) {
        const until = this._map.get(userId) ?? 0;
        const now = Date.now();
        if (now < until) return { ok: false, remainingMs: until - now };
        return { ok: true };
    }

    set(userId) {
        const cooldownMs = Number(process.env.IMG_COOLDOWN_MS) || 20_000;
        this._map.set(userId, Date.now() + cooldownMs);
        setTimeout(() => this._map.delete(userId), cooldownMs + 1000);
    }
}

// ─── GPU API 呼び出し ───────────────────────────────────────────────────────

async function callGpuApi(base, token, prompt, requestId) {
    const timeoutMs = Number(process.env.GPU_API_TIMEOUT_MS) || 120_000;
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${base}/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ prompt }),
            signal: controller.signal
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "(no body)");
            throw new Error(`gpu_api_error status=${res.status} body=${text}`);
        }

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) {
            throw new Error("gpu_api returned empty response");
        }

        logger.debug("imagegen.gpu_api.success", { requestId, bytes: buf.length });
        return buf;
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error(`gpu_api_timeout: ${timeoutMs}ms を超えました`);
        }
        throw err;
    } finally {
        clearTimeout(timerId);
    }
}

// ─── エラー返信ヘルパー ─────────────────────────────────────────────────────

async function replyError(interaction, message, respond = null) {
    try {
        if (respond) {
            // respond 関数がある場合は統一的に使う（isQueued 対応）
            await respond({ content: message });
        } else if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: message });
        } else {
            await interaction.reply({ content: message, flags: 64 });
        }
    } catch (e) {
        logger.error("imagegen.reply.error_failed", { err: e?.message });
    }
}

// ─── 自動削除ヘルパー ───────────────────────────────────────────────────────

function scheduleAutoDelete(interaction, requestId) {
    const sec = Number(process.env.IMG_AUTO_DELETE_SEC) || 0;
    if (sec <= 0) return;

    setTimeout(async () => {
        try {
            await interaction.deleteReply();
            logger.info("imagegen.auto_delete.done", { requestId, afterSec: sec });
        } catch (err) {
            // 既に削除済みなどは無視
            logger.debug("imagegen.auto_delete.skip", { requestId, err: err?.message });
        }
    }, sec * 1000);
}

// ─── モジュールスコープのシングルトン ───────────────────────────────────────

const queue = new ImageGenQueue();
const cooldown = new CooldownManager();
let _dbPath = null;

function getDb() {
    return openDb(_dbPath);
}

// ─── メイン処理 ────────────────────────────────────────────────────────────

module.exports = {
    name: FEATURE_NAME,

    enabled: () => isFeatureEnabled(FEATURE_NAME),

    async setup(client, { dbPath } = {}) {
        _dbPath = dbPath;

        // DBマイグレーション
        if (dbPath) {
            try {
                const db = openDb(dbPath);
                await migrateViolations(db);
                db.close();
                logger.info("imagegen.migrations.done");
            } catch (err) {
                logger.error("imagegen.migrations.failed", { err: err?.message });
            }
        }

        logger.info("imagegen.feature.setup.complete");

        // ─── /img コマンド ───────────────────────────────────────────────
        client.on("interactionCreate", async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.commandName !== "img") return;

            const requestId = logger.makeRequestId();
            const userId = interaction.user?.id;
            const guildId = interaction.guildId ?? "DM";

            // ── 1. 入力バリデーション ──────────────────────────────────
            const mode = interaction.options.getString("mode", true);
            const style = interaction.options.getString("style");
            const main = interaction.options.getString("main");
            const scene = interaction.options.getString("scene");
            const freePrompt = interaction.options.getString("prompt");

            let rawPrompt = "";
            if (mode === "preset") {
                if (!normalizePrompt(main)) {
                    await interaction.reply({
                        content: "presetモードでは `main`（メインの被写体）を入力してください。",
                        flags: 64
                    });
                    return;
                }
                rawPrompt = buildPresetPrompt({ style, main, scene });
            } else {
                rawPrompt = normalizePrompt(freePrompt);
                if (!rawPrompt) {
                    await interaction.reply({
                        content: "freeモードでは `prompt`（完全自由入力）を入力してください。",
                        flags: 64
                    });
                    return;
                }
            }

            if (rawPrompt.length > 1000) {
                await interaction.reply({
                    content: "プロンプトが長すぎます（1000文字以内にしてください）。",
                    flags: 64
                });
                return;
            }

            // ── 2. GPU_API_BASE 確認 ────────────────────────────────────
            const base = process.env.GPU_API_BASE;
            const token = process.env.GPU_API_TOKEN;
            if (!base) {
                logger.warn("imagegen.config.missing_base", { requestId });
                await interaction.reply({
                    content: "GPU_API_BASE が未設定です。管理者に連絡してください。",
                    flags: 64
                });
                return;
            }

            // ── 3. BANチェック ─────────────────────────────────────────
            if (dbPath) {
                const db = getDb();
                try {
                    const banResult = await checkBan(db, userId, guildId);
                    if (banResult.banned) {
                        const minLeft = Math.ceil(banResult.remainingMs / 60000);
                        await interaction.reply({
                            content: `🚫 あなたは現在 ImageGen の使用を制限されています。\nあと約 **${minLeft}分** で解除されます。`,
                            flags: 64
                        });
                        logger.info("imagegen.ban.blocked", { requestId, userId, guildId, minLeft });
                        return;
                    }
                } finally {
                    db.close();
                }
            }

            // ── 4. ロール制限チェック（本番サーバーのみ） ────────────
            // target.js の env: 'prod' のサーバーでのみロールを要求する。
            // テストサーバー（env: 'test'）では無条件に通過させる。
            const { getTargetsForGuild } = require("../../config/target");
            const guildTarget = getTargetsForGuild(guildId);
            const isProd = guildTarget?.env === "prod";
            if (isProd) {
                const REQUIRED_ROLE_ID = process.env.IMG_REQUIRED_ROLE_ID || "1451908949409534093";
                const memberRoles = interaction.member?.roles?.cache;
                if (!memberRoles?.has(REQUIRED_ROLE_ID)) {
                    await interaction.reply({
                        content: "この機能を使用するには、必要なロールが付与されていません。",
                        flags: 64
                    });
                    logger.info("imagegen.role.blocked", {
                        requestId, userId, guildId,
                        requiredRoleId: REQUIRED_ROLE_ID,
                        rolesAvailable: !!memberRoles
                    });
                    return;
                }
            } else {
                logger.debug("imagegen.role.skipped_non_prod", { requestId, userId, guildId, env: guildTarget?.env ?? "unknown" });
            }

            // ── 5. セーフティチェック（原文プロンプト） ────────────────
            const safetyResult = await checkPromptSafety(rawPrompt, requestId);
            if (!safetyResult.safe) {
                // 違反記録 & BAN処理
                if (dbPath) {
                    const db = getDb();
                    try {
                        const violation = await recordViolation(
                            db, userId, guildId, safetyResult.reason
                        );
                        await notifyModerator(client, {
                            userId, guildId,
                            count: violation.count,
                            reason: safetyResult.reason,
                            banUntil: violation.banUntil
                        });

                        // ユーザーへの返答を違反回数に応じて変える
                        let replyMsg = `🚫 そのプロンプトは生成できません。\n理由: ${safetyResult.reason}`;
                        if (violation.count >= 2) {
                            const minBan = Math.round(
                                (BAN_DURATIONS_MAP[violation.count] ?? BAN_DURATIONS_MAP[3]) / 60000
                            );
                            replyMsg += `\n⚠️ 違反 **${violation.count}回目** です。${minBan}分間の使用制限が適用されました。`;
                        } else {
                            replyMsg += `\n⚠️ 繰り返すと使用制限が適用されます。`;
                        }

                        await interaction.reply({ content: replyMsg, flags: 64 });
                    } finally {
                        db.close();
                    }
                } else {
                    await interaction.reply({
                        content: `🚫 そのプロンプトは生成できません。\n理由: ${safetyResult.reason}`,
                        flags: 64
                    });
                }

                logger.warn("imagegen.safety.rejected", {
                    requestId, userId, guildId,
                    source: safetyResult.source,
                    promptPreview: rawPrompt.slice(0, 60)
                });
                return;
            }

            // ── 6. ユーザー単位クールダウン ────────────────────────────
            const cdCheck = cooldown.check(userId);
            if (!cdCheck.ok) {
                const secLeft = Math.ceil(cdCheck.remainingMs / 1000);
                await interaction.reply({
                    content: `クールダウン中です。あと **${secLeft}秒** 待ってください。`,
                    flags: 64
                });
                return;
            }

            // ── 7. キュー登録 ──────────────────────────────────────────
            // Discord のインタラクションは 3 秒以内に最初のレスポンスが必要。
            // キュー待ちで時間が経過すると deferReply() が Unknown interaction になるため、
            // キュー登録「前」に必ず最初のレスポンスを返す。
            //
            // position=1（即実行）: deferReply() → editReply() で結果を返す
            // position≥2（待ち）  : reply() でエフェメラル通知 → followUp() で結果を返す

            // まず仮エンキューしてポジションだけ確認する
            const enqueueResult = queue.enqueue(userId, requestId, async () => {
                await runGeneration({
                    interaction, requestId, userId, guildId,
                    base, token, rawPrompt, mode,
                    isQueued: enqueueResult.position >= 2
                });
                cooldown.set(userId);
            });

            if (!enqueueResult.ok) {
                if (enqueueResult.reason === "already_queued") {
                    await interaction.reply({
                        content: "すでにキューに並んでいます。しばらくお待ちください。",
                        flags: 64  // EPHEMERAL
                    });
                } else {
                    const maxSize = process.env.IMG_QUEUE_MAX || 4;
                    await interaction.reply({
                        content: `キューが満杯です（最大 ${maxSize} 件）。しばらく後にお試しください。`,
                        flags: 64
                    });
                }
                return;
            }

            if (enqueueResult.position >= 2) {
                // 待ちあり: エフェメラルで「〇番目」通知。結果は followUp で返す
                await interaction.reply({
                    content: `⏳ **${enqueueResult.position}番目** に並んでいます。前の生成が終わったら自動で開始します。`,
                    flags: 64
                });
            } else {
                // 即実行: 3秒タイムアウト対策として先に deferReply しておく
                await interaction.deferReply();
            }

            logger.info("imagegen.command.received", {
                requestId, userId, guildId,
                channelId: interaction.channelId,
                mode, style: style || null,
                queuePosition: enqueueResult.position,
                promptLength: rawPrompt.length
            });
        });

        // ─── /imgmod コマンド（管理者用）────────────────────────────────
        client.on("interactionCreate", async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.commandName !== "imgmod") return;

            const requestId = logger.makeRequestId();

            // 権限チェック: ManageGuild or ManageMessages
            const member = interaction.member;
            const hasPermission =
                member?.permissions?.has?.("ManageGuild") ||
                member?.permissions?.has?.("ManageMessages");

            if (!hasPermission) {
                await interaction.reply({
                    content: "このコマンドは管理者のみ使用できます。",
                    flags: 64
                });
                return;
            }

            const subcommand = interaction.options.getSubcommand();
            const targetUser = interaction.options.getUser("user", true);
            const guildId = interaction.guildId ?? "DM";

            if (!dbPath) {
                await interaction.reply({ content: "DBが利用できません。", flags: 64 });
                return;
            }

            const db = getDb();
            try {
                if (subcommand === "info") {
                    const info = await getViolationInfo(db, targetUser.id, guildId);
                    if (!info) {
                        await interaction.reply({
                            content: `<@${targetUser.id}> の違反記録はありません。`,
                            flags: 64
                        });
                        return;
                    }

                    const banStatus = info.ban_until > Date.now()
                        ? `🔴 BAN中（<t:${Math.floor(info.ban_until / 1000)}:R> まで）`
                        : "✅ BAN なし";

                    await interaction.reply({
                        content: [
                            `📋 **ImageGen 違反情報** / <@${targetUser.id}>`,
                            `違反回数: **${info.count}回**`,
                            `最終違反: <t:${info.last_at}:f>`,
                            `最終理由: ${info.last_reason || "不明"}`,
                            `BAN状態: ${banStatus}`,
                        ].join("\n"),
                        flags: 64
                    });

                } else if (subcommand === "ban") {
                    const hours = interaction.options.getInteger("hours") ?? 24;
                    const banUntil = await setBan(db, targetUser.id, guildId, hours * 3600_000);
                    await interaction.reply({
                        content: `🔴 <@${targetUser.id}> を **${hours}時間** BAN しました。\n解除: <t:${Math.floor(banUntil / 1000)}:f>`,
                        flags: 64
                    });
                    logger.info("imagegen.mod.ban", {
                        requestId,
                        moderatorId: interaction.user.id,
                        targetUserId: targetUser.id,
                        hours
                    });

                } else if (subcommand === "unban") {
                    await setBan(db, targetUser.id, guildId, 0);
                    await interaction.reply({
                        content: `✅ <@${targetUser.id}> の BAN を解除しました。`,
                        flags: 64
                    });
                    logger.info("imagegen.mod.unban", {
                        requestId,
                        moderatorId: interaction.user.id,
                        targetUserId: targetUser.id
                    });

                } else if (subcommand === "reset") {
                    await resetViolation(db, targetUser.id, guildId);
                    await interaction.reply({
                        content: `✅ <@${targetUser.id}> の違反記録をリセットしました。`,
                        flags: 64
                    });
                    logger.info("imagegen.mod.reset", {
                        requestId,
                        moderatorId: interaction.user.id,
                        targetUserId: targetUser.id
                    });
                }
            } finally {
                db.close();
            }
        });
    },

    async teardown() {
        logger.info("imagegen.feature.teardown");
    }
};

// BAN時間のマップ（ユーザーメッセージ用）
const BAN_DURATIONS_MAP = {
    1: 0,
    2: 60 * 60 * 1000,
    3: 24 * 60 * 60 * 1000
};

// ─── 実際の生成処理（キューから呼ばれる） ──────────────────────────────────

async function runGeneration({ interaction, requestId, userId, guildId, base, token, rawPrompt, mode, isQueued = false }) {
    // isQueued=true  → キュー待ちだった: interaction は既に reply() 済み → followUp() で結果返す
    // isQueued=false → 即実行: interaction は deferReply() 済み → editReply() で結果返す
    const respond = isQueued
        ? (opts) => interaction.followUp(opts).catch((e) => { logger.warn("imagegen.followup.failed", { requestId, err: e?.message }); })
        : (opts) => interaction.editReply(opts).catch((e) => { logger.warn("imagegen.editreply.failed", { requestId, err: e?.message }); });

    try {
        if (!isQueued) {
            // deferReply は呼び出し元（キュー登録前）で済んでいるが、
            // 念のため未応答なら deferReply する（直接呼び出しなどの保険）
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply();
                logger.debug("imagegen.reply.deferred_fallback", { requestId });
            }
        }

        const translatedResult = await translateJapanesePrompt(rawPrompt, requestId);
        const prompt = translatedResult.prompt;

        // 翻訳後も念のためセーフティチェック（英語翻訳で意図が変わることへの対策）
        if (translatedResult.translated) {
            const postSafety = await checkPromptSafety(prompt, requestId);
            if (!postSafety.safe) {
                logger.warn("imagegen.safety.rejected_after_translate", {
                    requestId, userId,
                    originalPrompt: rawPrompt.slice(0, 60)
                });
                await respond({
                    content: "🚫 翻訳後のプロンプトが安全基準を満たしませんでした。"
                });
                return;
            }
        }

        logger.info("imagegen.generation.start", {
            requestId, userId, guildId, mode,
            translated: translatedResult.translated,
            promptLength: prompt.length
        });

        const buf = await callGpuApi(base, token, prompt, requestId);

        const file = new AttachmentBuilder(buf, { name: "image.png" });
        const header = translatedResult.translated
            ? `prompt(EN): ${prompt}\noriginal(JA): ${translatedResult.originalPrompt}`
            : `prompt: ${prompt}`;

        await respond({ content: header, files: [file] });

        logger.info("imagegen.command.success", {
            requestId, userId, guildId,
            bytes: buf.length, mode,
            translated: translatedResult.translated
        });

        // 自動削除スケジュール
        scheduleAutoDelete(interaction, requestId);

    } catch (err) {
        logger.error("imagegen.command.error", {
            requestId, userId,
            err: err?.message,
            stack: err?.stack
        });

        await replyError(
            interaction,
            `生成に失敗しました: ${err?.message || "unknown_error"}`,
            respond
        );
    }
}

function scheduleAutoDelete(interaction, requestId) {
    const sec = Number(process.env.IMG_AUTO_DELETE_SEC) || 0;
    if (sec <= 0) return;

    setTimeout(async () => {
        try {
            await interaction.deleteReply();
            logger.info("imagegen.auto_delete.done", { requestId, afterSec: sec });
        } catch (err) {
            logger.debug("imagegen.auto_delete.skip", { requestId, err: err?.message });
        }
    }, sec * 1000);
}
