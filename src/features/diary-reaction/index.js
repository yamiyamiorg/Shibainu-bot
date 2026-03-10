// src/features/diary-reaction/index.js
/**
 * 日記へのAI絵文字リアクション機能
 *
 * features.conf の値に応じて監視するフォーラムチャンネルが変わる:
 *   false       → 機能OFF
 *   true:test   → テストサーバーのフォーラムのみ
 *   true:prod   → 本番フォーラム ＋ テストフォーラム（両方同時監視）
 *
 * 設計上の配慮:
 *   - 即座に反応しない（30秒〜2分のランダム遅延）→ Bot感を抑える
 *   - ぬくもり機能のホワイトリスト絵文字とは被らないようプロンプトで制御
 *   - スレッドの最初のメッセージ（日記本文）のみ対象
 *   - Bot自身の投稿には反応しない
 */

const { Events } = require('discord.js');
const { logger } = require('../../services/logger');
const { getDiaryReactionConfig } = require('../../config/diaryReactionTarget');
const { selectEmojisForDiary } = require('./geminiService');

// 処理中スレッドIDの重複処理防止セット
const processingThreads = new Set();

module.exports = {
    name: 'diary-reaction',
    description: 'AI emoji reactions for secret diary forum posts (multi-channel)',

    enabled: () => {
        const { isFeatureEnabled } = require('../../utils/featureConfig');
        return isFeatureEnabled('diaryreaction');
    },

    async setup(client) {
        const config = getDiaryReactionConfig();

        logger.info('diary-reaction.feature.setup', {
            env: config.env,
            forumChannelIds: config.forumChannelIds,
            delayMinMs: config.delayMinMs,
            delayMaxMs: config.delayMaxMs,
        });

        if (!config.forumChannelIds || config.forumChannelIds.length === 0) {
            logger.warn('diary-reaction.setup.no_channel_ids', {
                message: 'フォーラムチャンネルIDが設定されていません。機能を無効化します。',
            });
            return;
        }

        // 有効なチャンネルIDのSetを作成（高速ルックアップ用）
        const targetChannelIds = new Set(config.forumChannelIds.filter(Boolean));

        logger.info('diary-reaction.feature.ready', {
            targetChannelIds: [...targetChannelIds],
        });

        // フォーラムに新しいスレッド（日記投稿）が作成されたとき
        client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
            try {
                if (!newlyCreated) return;

                // 監視対象のフォーラムチャンネルかチェック
                if (!targetChannelIds.has(String(thread.parentId))) return;

                // Bot自身のスレッドは無視
                if (thread.ownerId === client.user?.id) return;

                logger.info('diary-reaction.thread.detected', {
                    threadId: thread.id,
                    threadName: thread.name,
                    parentId: thread.parentId,
                    ownerId: thread.ownerId,
                });

                const starterMessage = await fetchStarterMessage(thread);
                if (!starterMessage) return;

                const content = starterMessage.content?.trim() || '';
                if (content.length < 5) {
                    logger.debug('diary-reaction.thread.too_short', {
                        threadId: thread.id,
                        length: content.length,
                    });
                    return;
                }

                // 二重処理防止
                if (processingThreads.has(thread.id)) return;
                processingThreads.add(thread.id);

                const delay = randomDelay(config.delayMinMs, config.delayMaxMs);
                logger.info('diary-reaction.reaction.scheduled', {
                    threadId: thread.id,
                    delaySeconds: Math.round(delay / 1000),
                });

                setTimeout(async () => {
                    try {
                        await reactToMessage(starterMessage, content, config);
                    } finally {
                        processingThreads.delete(thread.id);
                    }
                }, delay);

            } catch (err) {
                processingThreads.delete(thread.id);
                logger.error('diary-reaction.thread.error', {
                    threadId: thread?.id,
                    err: err?.message,
                    stack: err?.stack,
                });
            }
        });
    },

    async teardown() {
        processingThreads.clear();
        logger.info('diary-reaction.feature.teardown');
    },
};

// ─────────────────────────────────────────────
// スレッドの最初のメッセージを取得
// ─────────────────────────────────────────────

async function fetchStarterMessage(thread) {
    try {
        if (thread.starterMessage) return thread.starterMessage;
        const messages = await thread.messages.fetch({ limit: 1, after: '0' });
        const first = messages.first();
        if (!first) logger.warn('diary-reaction.starter_message.not_found', { threadId: thread.id });
        return first || null;
    } catch (err) {
        logger.error('diary-reaction.starter_message.fetch_error', {
            threadId: thread.id,
            err: err?.message,
        });
        return null;
    }
}

// ─────────────────────────────────────────────
// メッセージに絵文字リアクションを付ける
// ─────────────────────────────────────────────

async function reactToMessage(message, content, config) {
    const trimmedContent = content.slice(0, config.maxContentLength);
    const emojis = await selectEmojisForDiary(trimmedContent, config.reactionCount);

    if (emojis.length === 0) {
        logger.warn('diary-reaction.react.no_emojis', { messageId: message.id });
        return;
    }

    logger.info('diary-reaction.react.start', { messageId: message.id, emojis });

    for (const emoji of emojis) {
        try {
            await message.react(emoji);
            await sleep(800); // Discord API レート制限対策
        } catch (err) {
            logger.warn('diary-reaction.react.emoji_failed', {
                messageId: message.id,
                emoji,
                err: err?.message,
            });
        }
    }

    logger.info('diary-reaction.react.complete', { messageId: message.id, emojis });
}

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

function randomDelay(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
