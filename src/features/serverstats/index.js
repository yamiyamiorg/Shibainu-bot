// src/features/serverstats/index.js
/**
 * ServerStats 統合版
 *
 * analytics機能を廃止・統合。単一ファイルで以下を担う:
 *
 *  [ServerStats既存]
 *   A-1〜A-6, B-1〜B-3, C-1: Embed表示
 *   週次レポート（強化版: メッセージ統計・絵文字TOP3追加）
 *
 *  [analytics統合]
 *   - VCセッション管理（ミュートなし発話時間計測・再起動跨ぎ保証）
 *   - 絵文字使用統計（MessageCreate / MessageReactionAdd）
 *   - 日次発言ユーザー数・メッセージ数（週次レポート用）
 *
 *  [新機能]
 *   - 常連スコア（VC部屋に常連さんが何人いるか表示）
 *   - VC入室ログ（直近入室タイムスタンプ・今日の出入り回数）
 *   - 呼び水通知 / 今がチャンス通知
 *   - 今日の一言（毎朝ServerStatsチャンネルに別メッセージとして投稿）
 */

const { Events, ChannelType, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { logger } = require('../../services/logger');
const { getServerStatsConfig } = require('../../config/serverStatsTarget');
const { buildStatsEmbed, buildWeeklyReportEmbed, buildCumulativeReportEmbed } = require('./formatter');
const db = require('./db');
const vcSessions = require('./vcSessions');
const { getTopRegulars } = require('./regularScore');
const { evaluateVcNotifications, loadExcludedIds, calcEffectiveVcTotal, isExcludedRecommendRoom } = require('./vcNotifier');
const { postOrUpdateDailyWord } = require('./dailyWord');
const { collectServerStats, collectVcRooms, collectAndSaveKeywords, getDiaryReactionCount } = require('./statsCollector');
const { hasMaintenanceAccess } = require('../../utils/maintenanceAccess');

// サーバーごとのStatsメッセージIDキャッシュ
// 役割: DB参照の都度コストを避けるためのインメモリキャッシュ
// 正の状態はDB側が持つ。起動時・edit失敗時にDBと同期する。
const statsMessageIds = new Map();
const lastWeeklyReportKeys = new Map();

// タイマー管理
let displayTimer = null;
let snapshotTimer = null;
let weeklyTimer = null;
let dailyWordTimer = null;

const MESSAGE_SLOT_DEFS = [
    { key: 'server_status', keyword: 'サーバー状況' },
    { key: 'vc_buzz', keyword: 'VCが賑わってるよ' },
    { key: 'daily_word', keyword: '今日の一言' },
    { key: 'weekly_report', keyword: '先週のサーバーまとめ' },
    { key: 'cumulative_report', keyword: '累計のサーバーまとめ' },
];

const serverstatsRefreshCmd = new SlashCommandBuilder()
    .setName('serverstats-refresh')
    .setDescription('ServerStatsの手動更新（送信なし・編集のみ）')
    .addStringOption((opt) =>
        opt
            .setName('mode')
            .setDescription('更新対象')
            .setRequired(true)
            .addChoices(
                { name: '統計まとめのみ（先週 + 累計）', value: 'summary_only' },
                { name: '全更新（サーバー状況 + VC + 先週 + 累計）', value: 'all' },
            )
    );

// ─────────────────────────────────────────────
// Unicode絵文字 + カスタム絵文字 抽出（analytics統合）
// ─────────────────────────────────────────────

const UNICODE_EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
const CUSTOM_EMOJI_RE = /<a?:([^:]+):\d+>/g;

function extractEmojis(content) {
    const found = [];
    const unicode = content.match(UNICODE_EMOJI_RE) || [];
    found.push(...unicode);
    CUSTOM_EMOJI_RE.lastIndex = 0;
    let m;
    while ((m = CUSTOM_EMOJI_RE.exec(content)) !== null) {
        found.push(`:${m[1]}:`);
    }
    return found;
}

// ─────────────────────────────────────────────
// feature定義
// ─────────────────────────────────────────────

module.exports = {
    name: 'serverstats',
    description: 'Server statistics + VC session tracking + weekly report + daily word + VC notifications',
    commands: [serverstatsRefreshCmd.toJSON()],

    enabled: () => {
        const { isFeatureEnabled } = require('../../utils/featureConfig');
        return isFeatureEnabled('serverstats');
    },

    async setup(client) {
        const config = getServerStatsConfig();

        logger.info('serverstats.feature.setup', {
            env: config.env,
            targets: config.targets.map(t => `${t.label}(${t.guildId})`),
            updateInterval: config.updateInterval + ' minutes',
        });

        client.on(Events.InteractionCreate, async (interaction) => {
            try {
                await onServerstatsRefreshInteraction(interaction, client, config);
            } catch (err) {
                logger.error('serverstats.refresh_cmd.error', {
                    guildId: interaction.guildId,
                    userId: interaction.user?.id,
                    err: err?.message,
                });
            }
        });

        // ── VCセッション管理（analytics統合） ──────────────────────────
        client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
            try {
                const userId = newState.member?.id || oldState.member?.id;
                const guildId = newState.guild?.id || oldState.guild?.id;
                if (!userId || !guildId) return;
                if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

                // 対象サーバーのみ
                const isTarget = config.targets.some(t => String(t.guildId) === String(guildId));
                if (!isTarget) return;

                const joined = !oldState.channelId && newState.channelId;
                const left = oldState.channelId && !newState.channelId;
                const moved = oldState.channelId && newState.channelId
                    && oldState.channelId !== newState.channelId;
                const muteChgd = oldState.selfMute !== newState.selfMute
                    || oldState.selfDeaf !== newState.selfDeaf;

                if (joined) {
                    vcSessions.startVcSession(userId, guildId, newState.channelId);
                    if (newState.selfMute || newState.selfDeaf) {
                        vcSessions.updateVcMuteState(userId, guildId, !!newState.selfMute, !!newState.selfDeaf);
                    }
                    // VC入室ログ記録（タイムスタンプ・出入り回数用）
                    await db.recordVcEntry(guildId, newState.channelId, userId).catch(() => { });
                } else if (left) {
                    await vcSessions.endVcSession(userId, guildId);
                } else if (moved) {
                    vcSessions.updateVcChannel(userId, guildId, newState.channelId);
                    await db.recordVcEntry(guildId, newState.channelId, userId).catch(() => { });
                }

                if (muteChgd && newState.channelId) {
                    vcSessions.updateVcMuteState(userId, guildId, !!newState.selfMute, !!newState.selfDeaf);
                }
            } catch (err) {
                logger.error('serverstats.vc.error', { err: err?.message });
            }
        });

        // ── 絵文字統計収集（analytics統合） ────────────────────────────
        client.on(Events.MessageCreate, async (message) => {
            try {
                if (message.author?.bot || !message.guildId) return;
                const isTarget = config.targets.some(t => String(t.guildId) === String(message.guildId));
                if (!isTarget) return;

                const content = message.content || '';
                const emojis = extractEmojis(content);
                const emojiCounts = {};
                for (const e of emojis) emojiCounts[e] = (emojiCounts[e] || 0) + 1;

                for (const [emoji, count] of Object.entries(emojiCounts)) {
                    await db.recordEmoji(message.guildId, emoji, count).catch(() => { });
                }

                // 発言日次集計（週次レポートのactive_users / total_messages用）
                await db.recordDailyMessage(message.guildId, message.author.id).catch(() => { });
            } catch (err) {
                logger.error('serverstats.message.error', { err: err?.message });
            }
        });

        client.on(Events.MessageReactionAdd, async (reaction, user) => {
            try {
                if (user.bot) return;
                const guildId = reaction.message.guildId;
                if (!guildId) return;
                const isTarget = config.targets.some(t => String(t.guildId) === String(guildId));
                if (!isTarget) return;

                if (reaction.partial) await reaction.fetch().catch(() => null);

                const emoji = reaction.emoji.id
                    ? `:${reaction.emoji.name}:`
                    : reaction.emoji.name;
                if (emoji) await db.recordEmoji(guildId, emoji, 1).catch(() => { });
            } catch (err) {
                logger.error('serverstats.reaction.error', { err: err?.message });
            }
        });

        // ── 新規メンバー参加記録 ────────────────────────────────────────
        client.once(Events.ClientReady, async () => {
            try {
                // VCセッション復元（再起動跨ぎ）
                for (const target of config.targets) {
                    const restored = await vcSessions.restoreVcCheckpoints(target.guildId);
                    if (restored > 0) {
                        logger.info('serverstats.vc.checkpoint_restored', {
                            guildId: target.guildId, count: restored,
                        });
                    }
                    const guild = client.guilds.cache.get(target.guildId);
                    if (guild) await scanLiveVcSessions(guild, target.guildId);
                    // 改善③: DB管理の除外IDをメモリにロード
                    await loadExcludedIds(target.guildId).catch(() => { });
                    await vcSessions.clearVcCheckpoints(target.guildId);
                }

                // GuildMemberAdd
                client.on(Events.GuildMemberAdd, async (member) => {
                    const isTarget = config.targets.some(
                        t => String(t.guildId) === String(member.guild.id)
                    );
                    if (!isTarget) return;
                    await db.recordMemberJoin(String(member.guild.id), String(member.id)).catch(() => { });
                });

                // 各ターゲット初期化（間隔を空けてレート制限回避）
                for (let i = 0; i < config.targets.length; i++) {
                    if (i > 0) await new Promise(r => setTimeout(r, 35_000));
                    await initTarget(client, config.targets[i]);
                }

                // Embed更新タイマー（5分ごと）
                const displayMs = config.updateInterval * 60 * 1000;
                displayTimer = setInterval(async () => {
                    for (const target of config.targets) {
                        try {
                            const guild = client.guilds.cache.get(target.guildId);
                            const ch = await fetchStatsChannel(guild, target.statsChannelId);
                            if (guild && ch) await refreshDisplay(client, guild, ch, target.guildId);
                        } catch (e) {
                            logger.error('serverstats.display_timer.error', { label: target.label, err: e?.message });
                        }
                    }
                }, displayMs);

                // スナップショット保存 + 累計レポート更新タイマー（1時間ごと）
                snapshotTimer = setInterval(async () => {
                    for (const target of config.targets) {
                        try {
                            const guild = client.guilds.cache.get(target.guildId);
                            const ch = await fetchStatsChannel(guild, target.statsChannelId);
                            if (!guild || !ch) continue;
                            await refreshDisplay(client, guild, ch, target.guildId, { saveSnapshot: true });
                            await upsertCumulativeReport(guild, ch, { allowCreate: false });
                            await collectAndSaveKeywords(guild);
                            await db.purgeOldSnapshots(String(guild.id), 90, 20);
                            await db.purgeOldJoinLog(String(guild.id));
                            await db.purgeOldKeywordLog(String(guild.id));
                            await db.purgeOldEmojiLog(String(guild.id));
                            await db.purgeOldVcEntryLog(String(guild.id));
                        } catch (e) {
                            logger.error('serverstats.snapshot_timer.error', { label: target.label, err: e?.message });
                        }
                    }
                }, 60 * 60 * 1000);

                // 週次レポート（毎分チェック → 月曜0時JST以降に週1回更新）
                weeklyTimer = setInterval(async () => {
                    const weeklyRun = getWeeklyRunWindowJst();
                    if (!weeklyRun.shouldRun) return;

                    for (const target of config.targets) {
                        try {
                            const guild = client.guilds.cache.get(target.guildId);
                            const ch = await fetchStatsChannel(guild, target.statsChannelId);
                            if (!guild || !ch) continue;
                            const runKey = `${target.guildId}:${weeklyRun.weekKey}`;
                            if (lastWeeklyReportKeys.get(String(target.guildId)) === runKey) continue;
                            await maybePostWeeklyReport(guild, ch);
                            lastWeeklyReportKeys.set(String(target.guildId), runKey);
                        } catch (e) {
                            logger.error('serverstats.weekly_timer.error', { label: target.label, err: e?.message });
                        }
                    }
                }, 60 * 1000); // 1分ごと

                // 今日の一言（毎分チェック → 毎朝8時JSTに投稿）
                // 毎時チェックだと再起動タイミングによって8時台を丸ごとスキップする恐れがあるため
                // 毎分チェックに変更。postOrUpdateDailyWordはべき等なので重複投稿しない。
                dailyWordTimer = setInterval(async () => {
                    const now = new Date(Date.now() + 9 * 3600 * 1000); // JST
                    if (now.getUTCHours() !== 8) return;
                    for (const target of config.targets) {
                        try {
                            const guild = client.guilds.cache.get(target.guildId);
                            const ch = await fetchStatsChannel(guild, target.statsChannelId);
                            if (guild && ch) await postOrUpdateDailyWord(ch, target.guildId);
                        } catch (e) {
                            logger.error('serverstats.dailyword_timer.error', { label: target.label, err: e?.message });
                        }
                    }
                }, 60 * 1000); // 1分ごと

                logger.info('serverstats.ready.complete', {
                    activeTargets: config.targets.map(t => t.label),
                });
            } catch (err) {
                logger.error('serverstats.ready.error', { err: err?.message, stack: err?.stack });
            }
        });
    },

    async teardown() {
        if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
        if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
        if (weeklyTimer) { clearInterval(weeklyTimer); weeklyTimer = null; }
        if (dailyWordTimer) { clearInterval(dailyWordTimer); dailyWordTimer = null; }
        statsMessageIds.clear();
        lastWeeklyReportKeys.clear();

        // VCセッションをチェックポイントに保存してから終了
        const config = getServerStatsConfig();
        for (const target of config.targets) {
            await vcSessions.saveVcCheckpoints(target.guildId).catch(() => { });
        }

        logger.info('serverstats.feature.teardown');
    },
};

// ─────────────────────────────────────────────
// 初期化（ターゲット1つあたり）
// ─────────────────────────────────────────────

async function initTarget(client, target) {
    const guild = await fetchGuild(client, target.guildId);
    if (!guild) {
        logger.warn('serverstats.init.guild_not_found', { label: target.label, guildId: target.guildId });
        return;
    }
    const statsChannel = await fetchStatsChannel(guild, target.statsChannelId);
    if (!statsChannel) {
        logger.warn('serverstats.init.channel_not_found', { label: target.label, channelId: target.statsChannelId });
        return;
    }

    // チャンネルを整理してDBにIDを記録。返り値 = 欠損スロット名のSet
    const missingSlots = await cleanupChannelToPreservedMessages(statsChannel, target.guildId);

    logger.info('serverstats.init.slots', {
        label: target.label,
        missingSlots: [...missingSlots],
    });

    // Stats Embed（欠損なら新規send許可、あればeditのみ）
    await refreshDisplay(client, guild, statsChannel, target.guildId, {
        saveSnapshot: true,
        allowCreate: missingSlots.has('server_status'),
    });

    // 今日の一言（欠損なら新規send許可）
    await postOrUpdateDailyWord(statsChannel, target.guildId, { allowCreate: missingSlots.has('daily_word') });

    // 週次レポート（欠損なら新規send許可）
    await upsertWeeklyReport(guild, statsChannel, { allowCreate: missingSlots.has('weekly_report') });
    // 累計レポート（欠損なら新規send許可）
    await upsertCumulativeReport(guild, statsChannel, { allowCreate: missingSlots.has('cumulative_report') });

    logger.info('serverstats.init.complete', { label: target.label });
}

// ─────────────────────────────────────────────
// チャンネルクリーンアップ
// 固定スロット（タイトル一致）だけ残し、重複は削除
// ─────────────────────────────────────────────

async function cleanupChannelToPreservedMessages(channel, guildId) {
    logger.info('serverstats.cleanup.start', {
        guildId,
        channelId: channel.id,
        slots: MESSAGE_SLOT_DEFS.map(s => s.keyword),
    });

    try {
        let before = null;
        let scanned = 0;
        const allMessages = [];

        while (true) {
            const fetchOptions = before ? { limit: 100, before } : { limit: 100 };
            const messages = await channel.messages.fetch(fetchOptions);
            if (messages.size === 0) break;

            scanned += messages.size;
            allMessages.push(...messages.values());

            before = messages.last()?.id || null;
            if (!before || messages.size < 100) break;
        }

        const botId = channel.client.user?.id;
        const botMessages = allMessages.filter((m) => m.author?.id === botId);

        const slots = new Map(MESSAGE_SLOT_DEFS.map((d) => [d.key, []]));
        for (const msg of botMessages) {
            const title = extractPrimaryEmbedTitle(msg);
            if (!title) continue;
            for (const def of MESSAGE_SLOT_DEFS) {
                if (title.includes(def.keyword)) {
                    slots.get(def.key).push(msg);
                    break;
                }
            }
        }

        // 各スロットは最古の1件を正本として残す（ID固定に依存しない）
        const keepers = new Map();
        for (const def of MESSAGE_SLOT_DEFS) {
            const candidates = slots.get(def.key) || [];
            if (candidates.length === 0) continue;
            candidates.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            keepers.set(def.key, candidates[0]);
        }

        // 週次重複があり、累計スロットが未作成なら最新の週次メッセージを累計に流用
        const weeklyCandidates = (slots.get('weekly_report') || [])
            .slice()
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        if (!keepers.has('cumulative_report') && weeklyCandidates.length >= 2) {
            const latestWeekly = weeklyCandidates[weeklyCandidates.length - 1];
            const oldestWeekly = weeklyCandidates[0];
            if (String(latestWeekly.id) !== String(oldestWeekly.id)) {
                keepers.set('cumulative_report', latestWeekly);
            }
        }

        const keepIds = new Set([...keepers.values()].map((m) => String(m.id)));
        const deletable = botMessages.filter((m) => !keepIds.has(String(m.id)));

        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const recent = deletable.filter((m) => m.createdTimestamp > twoWeeksAgo);
        const old = deletable.filter((m) => m.createdTimestamp <= twoWeeksAgo);

        let deleted = 0;

        for (let i = 0; i < recent.length; i += 100) {
            const chunk = recent.slice(i, i + 100);
            if (chunk.length === 1) {
                await chunk[0].delete().then(() => { deleted += 1; }).catch((err) => {
                    logger.warn('serverstats.cleanup.delete_failed', {
                        guildId, channelId: channel.id, messageId: chunk[0].id, err: err?.message,
                    });
                });
                continue;
            }

            const ids = chunk.map((m) => m.id);
            await channel.bulkDelete(ids, true).then((res) => {
                deleted += (res?.size ?? chunk.length);
            }).catch(async () => {
                for (const msg of chunk) {
                    await msg.delete().then(() => { deleted += 1; }).catch((err) => {
                        logger.warn('serverstats.cleanup.delete_failed', {
                            guildId, channelId: channel.id, messageId: msg.id, err: err?.message,
                        });
                    });
                }
            });
        }

        for (const msg of old) {
            await msg.delete().then(() => { deleted += 1; }).catch((err) => {
                logger.warn('serverstats.cleanup.delete_failed', {
                    guildId, channelId: channel.id, messageId: msg.id, err: err?.message,
                });
            });
        }

        const statusMsg = keepers.get('server_status');
        if (statusMsg) {
            statsMessageIds.set(String(guildId), String(statusMsg.id));
            await db.saveStatsMessageId(String(guildId), channel.id, String(statusMsg.id)).catch(() => { });
        }

        const dailyMsg = keepers.get('daily_word');
        if (dailyMsg) {
            await db.saveDailyWordMessageId(String(guildId), channel.id, String(dailyMsg.id), getTodayJst()).catch(() => { });
        }

        const weeklyMsg = keepers.get('weekly_report');
        if (weeklyMsg) {
            await db.saveWeeklyReportMessageId(String(guildId), channel.id, String(weeklyMsg.id)).catch(() => { });
        }
        const cumulativeMsg = keepers.get('cumulative_report');
        if (cumulativeMsg) {
            await db.saveCumulativeReportMessageId(String(guildId), channel.id, String(cumulativeMsg.id)).catch(() => { });
        }

        const vcMsg = keepers.get('vc_buzz');
        if (vcMsg) {
            await db.saveVcNotifyMessageId(String(guildId), channel.id, String(vcMsg.id)).catch(() => { });
        }

        const missing = MESSAGE_SLOT_DEFS.filter((d) => !keepers.has(d.key)).map((d) => d.key);

        logger.info('serverstats.cleanup.done', {
            guildId,
            channelId: channel.id,
            scanned,
            deleted,
            kept: keepIds.size,
            missingSlots: missing,
        });

        // 欠損スロットを返す（initTargetが初回sendの判断に使う）
        return new Set(missing);
    } catch (err) {
        logger.warn('serverstats.cleanup.error', { guildId, channelId: channel.id, err: err?.message });
        // エラー時は全スロット欠損扱い → initTargetで全て初回sendする
        return new Set(MESSAGE_SLOT_DEFS.map((d) => d.key));
    }
}

// ─────────────────────────────────────────────
// Embed更新
// ─────────────────────────────────────────────

async function refreshDisplay(client, guild, statsChannel, guildId, opts = {}) {
    try {
        const stats = await collectServerStats(guild);
        if (!stats) return;

        if (opts.saveSnapshot) {
            await db.saveStatsSnapshot(String(guildId), stats);
        }

        const vcRooms = collectVcRooms(guild);

        // VC部屋ごとのメタ情報（常連・入室ログ）を並列取得
        const vcRoomMeta = await buildVcRoomMeta(guild, guildId, vcRooms);

        const [prev, joinCount24h, lastJoinUnix, allTimePeaks, keywords, diaryReactionCount24h] =
            await Promise.all([
                db.getSnapshotNearHoursAgo(String(guildId), 24).catch(() => null),
                db.getRecentJoinCount(String(guildId), 24).catch(() => 0),
                db.getLastJoinTime(String(guildId)).catch(() => null),
                db.getAllTimePeaks(String(guildId)).catch(() => null),
                db.getRecentKeywords(String(guildId), 1, 5).catch(() => []),
                getDiaryReactionCount(guildId).catch(() => null),
            ]);

        const embed = buildStatsEmbed(
            stats, prev, joinCount24h, guild.createdAt,
            vcRooms, keywords, diaryReactionCount24h,
            lastJoinUnix, allTimePeaks, vcRoomMeta
        );

        await upsertStatsMessage(statsChannel, { embeds: [embed] }, guildId, { allowCreate: !!opts.allowCreate });

        // VC呼び水・チャンス通知の評価
        await evaluateVcNotifications(statsChannel, guild, vcRooms, stats.vcTotal, {
            ignoreCooldown: true,
            allowCreate: opts.allowCreateVcSlot !== false,
        }).catch(() => { });

        logger.info('serverstats.display.refreshed', {
            guildId, allMembers: stats.allMembers,
        });
    } catch (err) {
        logger.error('serverstats.display.error', { guildId, err: err?.message });
    }
}

// ─────────────────────────────────────────────
// VC部屋ごとのメタ情報構築（常連・入室ログ）
// ─────────────────────────────────────────────

async function buildVcRoomMeta(guild, guildId, vcRooms) {
    const meta = new Map();
    const regulars = await getTopRegulars(guild, guildId).catch(() => []);
    const regularUserIds = new Set(regulars.map(r => r.userId));

    for (const room of vcRooms) {
        if (room.total === 0) continue;

        // この部屋にいる常連さんの数
        const channel = guild.channels.cache.get(room.id);
        let regularCount = 0;
        if (channel) {
            for (const [, member] of channel.members) {
                if (regularUserIds.has(member.id)) regularCount++;
            }
        }

        // 直近入室タイムスタンプ・今日の出入り回数
        const [lastEntry, todayEntries] = await Promise.all([
            db.getLastVcEntry(guildId, room.id).catch(() => null),
            db.getTodayVcEntryCount(guildId, room.id).catch(() => 0),
        ]);

        meta.set(room.id, { regularCount, lastEntry, todayEntries });
    }
    return meta;
}

// ─────────────────────────────────────────────
// 週次レポート（強化版）
// ─────────────────────────────────────────────

// 週次レポートを常時表示・直近1週間のデータで更新（edit）
// 初回のみ新規send、以後は必ずedit
async function upsertWeeklyReport(guild, statsChannel, opts = {}) {
    const range = getLastCompletedWeekRangeJst();
    const fromDate = range.fromDate;
    const toDate = range.toDate;

    const [peak, hourlyAvg, msgStats, topEmojis, newJoinCount] = await Promise.all([
        db.getPeakVcInRange(String(guild.id), range.fromUnix, range.toUnix).catch(() => null),
        db.getHourlyVcAverageRange(String(guild.id), range.fromUnix, range.toUnix).catch(() => []),
        db.getWeeklyMessageStats(String(guild.id), fromDate, toDate).catch(() => null),
        db.getTopEmojisRange(String(guild.id), fromDate, toDate, 3).catch(() => []),
        db.getRecentJoinCount(String(guild.id), range.hours).catch(() => 0),
    ]);

    const embed = buildWeeklyReportEmbed(guild, peak, hourlyAvg, msgStats, topEmojis, newJoinCount);
    const payload = { embeds: [embed] };
    await upsertSummarySlot({
        guildId: String(guild.id),
        statsChannel,
        keyword: '先週のサーバーまとめ',
        payload,
        allowCreate: !!opts.allowCreate,
        getSavedId: db.getWeeklyReportMessageId,
        saveId: db.saveWeeklyReportMessageId,
        clearId: db.clearWeeklyReportMessageId,
        logKey: 'weekly_report',
    });
}

async function upsertCumulativeReport(guild, statsChannel, opts = {}) {
    const now = Date.now();
    const toUnix = Math.floor(now / 1000);
    const fromDate = '2000-01-01';
    const toDate = unixToDateStr(toUnix);

    const [peak, topMoments, hourlyAvg, msgWeeklyAvg, topEmojis, joinWeeklyAvg] = await Promise.all([
        db.getPeakVcInRange(String(guild.id), 0, toUnix).catch(() => null),
        db.getTopVcMoments(String(guild.id), 0, toUnix, 3).catch(() => []),
        db.getHourlyVcAverageRange(String(guild.id), 0, toUnix).catch(() => []),
        db.getAverageWeeklyMessageStats(String(guild.id), fromDate, toDate).catch(() => null),
        db.getTopEmojisRange(String(guild.id), fromDate, toDate, 3).catch(() => []),
        db.getAverageWeeklyJoinCount(String(guild.id), 0, toUnix).catch(() => null),
    ]);

    const embed = buildCumulativeReportEmbed(guild, peak, topMoments, hourlyAvg, msgWeeklyAvg, topEmojis, joinWeeklyAvg);
    const payload = { embeds: [embed] };

    const savedCumulative = await db.getCumulativeReportMessageId(String(guild.id)).catch(() => null);
    if (!savedCumulative?.message_id) {
        const savedWeekly = await db.getWeeklyReportMessageId(String(guild.id)).catch(() => null);
        const excludeIds = new Set(savedWeekly?.message_id ? [String(savedWeekly.message_id)] : []);
        const recycled = await findLatestBotMessageByTitle(statsChannel, '先週のサーバーまとめ', excludeIds);
        if (recycled) {
            await recycled.edit(payload);
            await db.saveCumulativeReportMessageId(String(guild.id), statsChannel.id, recycled.id).catch(() => { });
            logger.info('serverstats.cumulative_report.recycled_weekly_duplicate', {
                guildId: String(guild.id),
                messageId: recycled.id,
            });
            return;
        }
    }

    await upsertSummarySlot({
        guildId: String(guild.id),
        statsChannel,
        keyword: '累計のサーバーまとめ',
        payload,
        allowCreate: !!opts.allowCreate,
        getSavedId: db.getCumulativeReportMessageId,
        saveId: db.saveCumulativeReportMessageId,
        clearId: db.clearCumulativeReportMessageId,
        logKey: 'cumulative_report',
    });
}

async function upsertSummarySlot({
    guildId,
    statsChannel,
    keyword,
    payload,
    allowCreate,
    getSavedId,
    saveId,
    clearId,
    logKey,
}) {
    const saved = await getSavedId(guildId).catch(() => null);
    if (saved?.message_id) {
        try {
            const msg = await statsChannel.messages.fetch(saved.message_id);
            await msg.edit(payload);
            logger.info(`serverstats.${logKey}.updated`, { guildId, messageId: saved.message_id });
            return;
        } catch (err) {
            logger.warn(`serverstats.${logKey}.edit_failed_clearing`, {
                guildId, messageId: saved.message_id, err: err?.message,
            });
            await clearId(guildId).catch(() => { });
        }
    }

    const discovered = await findOldestBotMessageByTitle(statsChannel, keyword);
    if (discovered) {
        await discovered.edit(payload);
        await saveId(guildId, statsChannel.id, discovered.id).catch(() => { });
        logger.info(`serverstats.${logKey}.rebound`, { guildId, messageId: discovered.id });
        return;
    }

    if (!allowCreate) {
        logger.warn(`serverstats.${logKey}.no_target`, { guildId, channelId: statsChannel.id });
        return;
    }

    const msg = await statsChannel.send(payload);
    await saveId(guildId, statsChannel.id, msg.id).catch(() => { });
    logger.info(`serverstats.${logKey}.created`, { guildId, messageId: msg.id });
}

// 月曜0時JST以降に週1回更新（allowCreate=false: 増殖しない）
async function maybePostWeeklyReport(guild, statsChannel) {
    await upsertWeeklyReport(guild, statsChannel, { allowCreate: false });
}

async function onServerstatsRefreshInteraction(interaction, client, config) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'serverstats-refresh') return;

    if (!hasMaintenanceAccess(interaction.user?.id, interaction.member)) {
        await interaction.reply({
            content: 'このコマンドを実行する権限がありません。',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const mode = interaction.options.getString('mode') || 'summary_only';

    const target = config.targets.find((t) => String(t.guildId) === String(interaction.guildId));
    if (!target) {
        await interaction.editReply('このサーバーは serverstats の対象外です。');
        return;
    }

    const guild = await fetchGuild(client, target.guildId);
    const statsChannel = await fetchStatsChannel(guild, target.statsChannelId);
    if (!guild || !statsChannel) {
        await interaction.editReply('statsチャンネルを取得できませんでした。設定を確認してください。');
        return;
    }

    if (mode === 'all') {
        await refreshDisplay(client, guild, statsChannel, target.guildId, {
            saveSnapshot: true,
            allowCreate: false,
            allowCreateVcSlot: false,
        });
    }

    await upsertWeeklyReport(guild, statsChannel, { allowCreate: false });
    await upsertCumulativeReport(guild, statsChannel, { allowCreate: false });

    if (mode === 'all') {
        await interaction.editReply('✅ 全更新（編集のみ）を実行しました。');
        return;
    }
    await interaction.editReply('✅ 統計まとめ（先週 + 累計）の更新（編集のみ）を実行しました。');
}

// ─────────────────────────────────────────────
// データ収集
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 再起動時のVC現状スキャン
// ─────────────────────────────────────────────

async function scanLiveVcSessions(guild, guildId) {
    let count = 0;
    for (const [, voiceState] of guild.voiceStates.cache) {
        if (!voiceState.channelId) continue;
        if (voiceState.member?.user?.bot) continue;
        const userId = voiceState.id;
        if (vcSessions.hasActiveSession(userId, guildId)) continue;

        vcSessions.startVcSession(userId, guildId, voiceState.channelId);
        if (voiceState.selfMute || voiceState.selfDeaf) {
            vcSessions.updateVcMuteState(userId, guildId, !!voiceState.selfMute, !!voiceState.selfDeaf);
        }
        count++;
    }
    if (count > 0) logger.info('serverstats.vc.live_scan', { guildId, newSessions: count });
}

// ─────────────────────────────────────────────
// StatsメッセージのUpsert（既存はedit、なければsend）
// ─────────────────────────────────────────────

async function upsertStatsMessage(channel, payload, guildId, opts = {}) {
    // インメモリキャッシュになければDBから復元
    if (!statsMessageIds.has(guildId)) {
        const saved = await db.getStatsMessageId(String(guildId)).catch(() => null);
        if (saved?.message_id) statsMessageIds.set(guildId, saved.message_id);
    }

    const existingId = statsMessageIds.get(guildId);

    // IDなし: allowCreate=trueのときのみ新規send（initTarget経由の初回のみ）
    if (!existingId) {
        if (!opts.allowCreate) {
            logger.warn('serverstats.stats_message.no_target', {
                guildId, channelId: channel.id,
            });
            return;
        }
        const msg = await channel.send(payload);
        statsMessageIds.set(guildId, msg.id);
        await db.saveStatsMessageId(String(guildId), channel.id, msg.id).catch(() => { });
        logger.info('serverstats.stats_message.created', { guildId, messageId: msg.id });
        return;
    }

    try {
        const msg = await channel.messages.fetch(existingId);
        await msg.edit(payload);
    } catch (err) {
        // edit失敗 = メッセージが消えた → キャッシュとDBをクリアして次回initで再補完させる
        logger.warn('serverstats.stats_message.edit_failed_clearing', {
            guildId, channelId: channel.id, messageId: existingId, err: err?.message,
        });
        statsMessageIds.delete(guildId);
        await db.clearStatsMessageId(String(guildId)).catch(() => { });
    }
}

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

function extractPrimaryEmbedTitle(msg) {
    const t = msg?.embeds?.[0]?.title;
    return typeof t === 'string' ? t : '';
}

async function findOldestBotMessageByTitle(channel, keyword) {
    const botId = channel.client.user?.id;
    if (!botId || !keyword) return null;

    let before = null;
    let oldest = null;

    while (true) {
        const options = before ? { limit: 100, before } : { limit: 100 };
        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        for (const [, msg] of messages) {
            if (msg.author?.id !== botId) continue;
            const title = extractPrimaryEmbedTitle(msg);
            if (!title.includes(keyword)) continue;
            if (!oldest || msg.createdTimestamp < oldest.createdTimestamp) oldest = msg;
        }

        before = messages.last()?.id || null;
        if (!before || messages.size < 100) break;
    }

    return oldest;
}

async function fetchGuild(client, guildId) {
    try {
        return client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
    } catch (err) {
        logger.error('serverstats.fetch_guild.error', { guildId, err: err?.message });
        return null;
    }
}

async function fetchStatsChannel(guild, channelId) {
    if (!guild || !channelId) return null;
    try {
        let ch = guild.channels.cache.get(channelId);
        if (!ch) ch = await guild.channels.fetch(channelId).catch(() => null);
        if (!ch || ch.type !== ChannelType.GuildText) return null;
        return ch;
    } catch (err) {
        logger.error('serverstats.fetch_channel.error', { channelId, err: err?.message });
        return null;
    }
}

function isoWeek(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function unixToDateStr(unixSec) {
    const d = new Date((unixSec + 32400) * 1000); // JST
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getTodayJst() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getLastCompletedWeekRangeJst(now = new Date()) {
    const jst = new Date(now.getTime() + 9 * 3600 * 1000);
    const daysSinceMonday = (jst.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    const thisWeekMondayUtc = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
    thisWeekMondayUtc.setUTCDate(thisWeekMondayUtc.getUTCDate() - daysSinceMonday);

    const thisWeekMondayUnix = Math.floor(thisWeekMondayUtc.getTime() / 1000) - 9 * 3600;
    const fromUnix = thisWeekMondayUnix - 7 * 86400;
    const toUnix = thisWeekMondayUnix - 1;

    return {
        fromUnix,
        toUnix,
        fromDate: unixToDateStr(fromUnix),
        toDate: unixToDateStr(toUnix),
        hours: 7 * 24,
    };
}

async function findLatestBotMessageByTitle(channel, keyword, excludeIds = new Set()) {
    const botId = channel.client.user?.id;
    if (!botId || !keyword) return null;

    let before = null;
    let latest = null;

    while (true) {
        const options = before ? { limit: 100, before } : { limit: 100 };
        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        for (const [, msg] of messages) {
            if (msg.author?.id !== botId) continue;
            if (excludeIds.has(String(msg.id))) continue;
            const title = extractPrimaryEmbedTitle(msg);
            if (!title.includes(keyword)) continue;
            if (!latest || msg.createdTimestamp > latest.createdTimestamp) latest = msg;
        }

        before = messages.last()?.id || null;
        if (!before || messages.size < 100) break;
    }

    return latest;
}

function getWeeklyRunWindowJst(now = new Date()) {
    const jst = new Date(now.getTime() + 9 * 3600 * 1000);
    const isMonday = jst.getUTCDay() === 1;
    const isAfterMidnight = jst.getUTCHours() >= 0;
    const weekKey = `${jst.getUTCFullYear()}-W${String(isoWeek(jst)).padStart(2, '0')}`;
    return { shouldRun: isMonday && isAfterMidnight, weekKey };
}
