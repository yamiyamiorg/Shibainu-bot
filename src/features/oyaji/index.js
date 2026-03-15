// src/features/oyaji/index.js
//
// 故郷のおやじBot - featureLoader エントリ。
//
// ── 再起動フェイルセーフ ─────────────────────────────────────────
//
//  setup() 内の先頭で recoverSessionsOnBoot(client) を呼ぶ。
//  回復結果をログに残し、recovered > 0 の場合は
//  「おやじが帰ってきた」通知をテキストチャンネルに送る。
//
//  _sessionMeta はインメモリなので再起動で消えるが、
//  tickOneSession() の中で alone_since が null なら初期化されるため
//  回復後の tick は自然に再開される。

'use strict';

const { Events, MessageFlags } = require('discord.js');
const { logger } = require('../../services/logger');
const { isFeatureEnabled } = require('../../utils/featureConfig');

const db = require('./oyajiDb');
const { classify } = require('./classifier');
const { matchTemplate, recordTemplateUsage } = require('./templateMatcher');
const { decideFallback, buildOyajiPrompt, fallbackReply } = require('./oyajiPersona');
const { getLifeStage, getStatusSummary } = require('./rankSystem');
const { generateContent } = require('../../services/gemini');

// ── 定数 ─────────────────────────────────────────────────────────

const TICK_INTERVAL_MS    = 60 * 1000;
const SESSION_ALONE_LIMIT = 5; // Bot 単独がこの分数続いたら終了

// ── ランクアップメッセージ（段階移行ごと）───────────────────────

const RANK_UP_MESSAGES = {
  childhood:     ['お、来たが。まあ上がれや。なんもなくてもええ。', 'よしよし、来たな。ほれ、こっちさ来い。'],
  elementary:    ['おう、学校どうだった。ちっとは大きくなったか。', 'また少し大きくなったか。母さんも喜ぶべ。'],
  junior_high:   ['もう中学か。早いもんだべな。…まあ、座れ。', 'そうか、中学生か。おれもそういう時期があった。'],
  high_school:   ['高校生か。…おれも昔はそうだった。まあ、ゆっくりしてけ。', 'あっという間だべな。まあ、無理すんな。'],
  college:       ['大学か。遠くなったな。…元気でやってっか。', 'そうか、大学生か。たまには帰ってこいよ。'],
  working_adult: ['社会人か。大変だべ。…まあ、帰ってきたんだからいい。', '働くようになったか。まあ、体に気をつけろ。'],
  parent:        ['親になったか。おれも似たようなもんだったべな。', 'そうか、おめえも親か。…感慨深いもんだべ。'],
};

// ── セッションメタ（インメモリ）──────────────────────────────────

/** @type {Map<string, { alone_since: number|null }>} */
const _sessionMeta = new Map();

let _tickTimer = null;

function startTickTimer(client) {
  if (_tickTimer) return;
  _tickTimer = setInterval(async () => {
    try { await tickAllSessions(client); }
    catch (err) { logger.error('oyaji.tick.error', { err: err?.message }); }
  }, TICK_INTERVAL_MS);
  logger.info('oyaji.tick.started');
}

// ── tick ─────────────────────────────────────────────────────────

async function tickAllSessions(client) {
  const sessions = db.getDb()
    .prepare(`SELECT * FROM oyaji_sessions WHERE status = 'active'`)
    .all();

  for (const session of sessions) {
    try { await tickOneSession(client, session); }
    catch (err) {
      logger.error('oyaji.tick.session_error', { sessionId: session.session_id, err: err?.message });
    }
  }
}

async function tickOneSession(client, session) {
  const { session_id, guild_id, voice_channel_id, owner_user_id } = session;

  const guild = client.guilds.cache.get(guild_id);
  if (!guild) return;

  const vc = guild.channels.cache.get(voice_channel_id);
  if (!vc) {
    db.endSession(session_id);
    _sessionMeta.delete(session_id);
    return;
  }

  const humanCount = vc.members.filter((m) => !m.user.bot).size;

  // Bot 単独チェック
  const meta = _sessionMeta.get(session_id) || { alone_since: null };
  if (humanCount === 0) {
    if (!meta.alone_since) meta.alone_since = Date.now();
    _sessionMeta.set(session_id, meta);
    if ((Date.now() - meta.alone_since) / 60000 >= SESSION_ALONE_LIMIT) {
      await handleSessionEnd(client, session, 'alone_timeout');
      return;
    }
  } else {
    meta.alone_since = null;
    _sessionMeta.set(session_id, meta);
  }

  if (!vc.members.has(owner_user_id) && humanCount === 0) return;

  const { rank, stage, rankChanged } = db.addMinutesAndUpdateRank(guild_id, owner_user_id, 1);
  db.tickSession(session_id, rank, stage);

  if (rankChanged) await notifyRankUp(client, session, rank, stage);
}

async function notifyRankUp(client, session, rank, stage) {
  const channelId = session.thread_channel_id || session.text_channel_id;
  const channel = client.channels.cache.get(channelId);
  if (!channel) return;

  const msgs = RANK_UP_MESSAGES[stage] || ['お、少し大きくなったか。'];
  const msg  = msgs[Math.floor(Math.random() * msgs.length)];
  const lifeStage = getLifeStage(rank);

  try {
    await channel.send(`**〜 ${lifeStage.label} になった 〜**\n${msg}`);
    logger.info('oyaji.rank_up', { sessionId: session.session_id, rank, stage });
  } catch (err) {
    logger.warn('oyaji.rank_up.send_failed', { err: err?.message });
  }
}

// ── セッション終了 ────────────────────────────────────────────────

async function handleSessionEnd(client, session, reason = 'manual') {
  db.endSession(session.session_id);
  _sessionMeta.delete(session.session_id);

  const channelId = session.thread_channel_id || session.text_channel_id;
  const channel = client.channels.cache.get(channelId);
  if (!channel) return;

  const endings = [
    'んだば今日はこのへんだな。戸ぁ閉めてけよ。',
    'まあ、ゆっくりしてけ。またいつでも来い。',
    'そうか、帰るか。…気をつけてな。',
    'また来いよ。おれはここにいっから。',
  ];
  const msg = endings[Math.floor(Math.random() * endings.length)];

  try { await channel.send(msg); }
  catch (err) { logger.warn('oyaji.session_end.send_failed', { reason, err: err?.message }); }
}

// ── 会話生成 ──────────────────────────────────────────────────────

async function generateReply({ session, userId, userText }) {
  const { session_id, guild_id, current_stage, current_rank } = session;

  const classifyResult = classify(userText, current_stage);

  const matchResult = matchTemplate({
    lifeStageId:       current_stage,
    primaryCategory:   classifyResult.primaryCategory,
    secondaryCategory: classifyResult.secondaryCategory,
    rank:              current_rank,
    normalizedText:    classifyResult.normalizedText,
    sessionId:         session_id,
  });

  const fallbackDecision = decideFallback(
    { category: classifyResult.primaryCategory, score: matchResult.score,
      hasMatch: matchResult.hasMatch, confidence: matchResult.confidence },
    userText,
  );

  let responseText = null;
  let usedAi       = false;
  let templateId   = null;

  if (fallbackDecision === 'SKIP' && matchResult.hasMatch) {
    responseText = matchResult.selectedResponse;
    templateId   = matchResult.templateId;
    recordTemplateUsage(session_id, templateId);
  } else {
    try {
      const memories      = db.getRecentMemories(guild_id, userId, 5);
      const interactions  = db.getRecentInteractions(session_id, 3);
      const prompt = buildOyajiPrompt({
        userText, lifeStageId: current_stage,
        category: classifyResult.primaryCategory,
        recentMemories: memories, recentInteractions: interactions,
      });
      responseText = await generateContent(prompt);
      usedAi = true;
    } catch (err) {
      logger.warn('oyaji.gemini.error', { err: err?.message });
      responseText = fallbackReply(current_stage);
    }
  }

  if (!responseText) responseText = fallbackReply(current_stage);

  db.logInteraction({ sessionId: session_id, userId, inputText: userText,
    category: classifyResult.primaryCategory, responseText, usedAi, templateId });

  if (matchResult.template?.memory_effect?.write) {
    const me = matchResult.template.memory_effect;
    db.writeMemory({ guildId: guild_id, userId, topicCategory: me.category,
      summary: me.summary_template, importance: me.importance || 1 });
  }

  return responseText;
}

// ── /oyaji status ─────────────────────────────────────────────────

function buildStatusText(guildId, userId) {
  const profile = db.getProfile(guildId, userId);
  if (!profile) return 'まだセッションが始まっていないべ。`/oyaji start` で呼んでくれ。';

  const { rank, lifeStage, minutesUntilNext, totalHours } = getStatusSummary(profile.total_minutes);
  return [
    `**現在の時代**: ${lifeStage.label}（主人公 ${lifeStage.ageChild}歳 / おやじ ${lifeStage.ageFather}歳）`,
    `**関係の深さ**: ${rank}`,
    `**次の思い出まで**: ${minutesUntilNext}分`,
    `**通算**: ${totalHours}`,
  ].join('\n');
}

// ── featureLoader エントリ ────────────────────────────────────────

module.exports = {
  name: 'oyaji',
  description: '故郷のおやじBot - VCで育てる父親ロールプレイ',

  enabled() {
    if (!process.env.GEMINI_API_KEY) return false;
    return isFeatureEnabled('oyaji');
  },

  async setup(client) {
    // テンプレートを起動時にロード
    require('./templateMatcher').getTemplateIndex();

    // ── 再起動フェイルセーフ ──────────────────────────────────────
    //
    // client.once('ready') 内で呼ぶことで、guilds.cache が確実に
    // 埋まった状態で照合できる。
    //
    client.once(Events.ClientReady, async () => {
      try {
        const result = await db.recoverSessionsOnBoot(client);

        // 回復できたセッションがあれば通知
        if (result.recovered > 0) {
          const recovered = db.getDb()
            .prepare(`SELECT * FROM oyaji_sessions WHERE status = 'active' AND restarted_at IS NOT NULL`)
            .all();

          for (const session of recovered) {
            const channelId = session.thread_channel_id || session.text_channel_id;
            const channel = client.channels.cache.get(channelId);
            if (!channel) continue;
            try {
              await channel.send('…おれも少し寝てたべ。続きやるか。');
            } catch {
              // 通知失敗は無視
            }
          }
        }
      } catch (err) {
        logger.error('oyaji.boot.recovery_error', { err: err?.message });
      }
    });

    // tick タイマー開始
    startTickTimer(client);

    // ── スラッシュコマンド ────────────────────────────────────────

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'oyaji') return;

      const sub       = interaction.options.getSubcommand(false);
      const userId    = interaction.user.id;
      const guildId   = interaction.guildId;
      const requestId = logger.makeRequestId?.() ?? `oyaji-${Date.now()}`;

      logger.info('oyaji.command', { requestId, sub, userId, guildId });

      try {
        // /oyaji start ─────────────────────────────────────────────
        if (sub === 'start') {
          const voiceState = interaction.member?.voice;
          if (!voiceState?.channelId) {
            await interaction.reply({ content: 'まずVCに入ってくれ。おやじはそっちに行く。', flags: MessageFlags.Ephemeral });
            return;
          }

          const session = db.startSession({
            guildId, voiceChannelId: voiceState.channelId,
            textChannelId: interaction.channelId, ownerUserId: userId,
          });

          if (!session) {
            await interaction.reply({ content: 'そのVCにはもうおやじがいるべ。', flags: MessageFlags.Ephemeral });
            return;
          }

          const greetings = [
            'お、来たが。まあ上がれや。なんもなくてもええ。',
            'おう、来たか。…そこ座れ。',
            '来たな。遅かったじゃねえか。…まあいい、上がれ。',
            'ほれ、ここさ来い。なんもしなくていい。',
          ];
          await interaction.reply(greetings[Math.floor(Math.random() * greetings.length)]);
          logger.info('oyaji.start.ok', { requestId, sessionId: session.session_id });
          return;
        }

        // /oyaji say ──────────────────────────────────────────────
        if (sub === 'say') {
          const voiceChId = interaction.member?.voice?.channelId;
          const session   = voiceChId ? db.getActiveSession(guildId, voiceChId) : null;

          if (!session) {
            await interaction.reply({ content: 'まず `/oyaji start` でおやじを呼んでくれ。', flags: MessageFlags.Ephemeral });
            return;
          }

          const userText = (interaction.options.getString('text') || '').trim();
          if (!userText) {
            await interaction.reply({ content: '…なんか言ってみれ。', flags: MessageFlags.Ephemeral });
            return;
          }

          await interaction.deferReply();
          const response = await generateReply({ session, userId, userText });
          const safe = response.length > 1900 ? response.slice(0, 1900) + '…' : response;
          await interaction.editReply(safe);
          logger.info('oyaji.say.ok', { requestId, sessionId: session.session_id });
          return;
        }

        // /oyaji status ───────────────────────────────────────────
        if (sub === 'status') {
          await interaction.reply({ content: buildStatusText(guildId, userId), flags: MessageFlags.Ephemeral });
          return;
        }

        // /oyaji leave ────────────────────────────────────────────
        if (sub === 'leave') {
          const voiceChId = interaction.member?.voice?.channelId;
          const session   = voiceChId ? db.getActiveSession(guildId, voiceChId) : null;

          if (!session) {
            await interaction.reply({ content: 'セッションが見つからなかったべ。', flags: MessageFlags.Ephemeral });
            return;
          }

          const isOwner = session.owner_user_id === userId;
          const isAdmin = interaction.member?.permissions?.has('ManageGuild');
          if (!isOwner && !isAdmin) {
            await interaction.reply({ content: '帰すのはセッションを始めた人だけだべ。', flags: MessageFlags.Ephemeral });
            return;
          }

          await handleSessionEnd(client, session, 'manual');
          await interaction.reply({ content: '…わかった。', flags: MessageFlags.Ephemeral });
          logger.info('oyaji.leave.ok', { requestId, sessionId: session.session_id });
          return;
        }

        // /oyaji help ─────────────────────────────────────────────
        if (sub === 'help') {
          await interaction.reply({
            content: [
              '**故郷のおやじBot - コマンド一覧**',
              '',
              '`/oyaji start`  - VCにおやじを呼ぶ',
              '`/oyaji say [text]`  - おやじに話しかける',
              '`/oyaji status`  - 現在の人生段階と関係の深さを確認',
              '`/oyaji leave`  - おやじを帰す',
              '',
              'VCで過ごした時間が積み重なり、親子の関係が変わっていくよ。',
            ].join('\n'),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

      } catch (err) {
        logger.error('oyaji.command.error', { requestId, sub, userId, guildId, err: err?.message, stack: err?.stack });
        const fallback = 'なんかうまくいかなかったべ。また話しかけてくれ。';
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply(fallback);
          else await interaction.reply({ content: fallback, flags: MessageFlags.Ephemeral });
        } catch { /* ignore */ }
      }
    });

    // ── VoiceStateUpdate: オーナー退出でセッション終了 ───────────

    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      if (!oldState.channelId) return;
      if (newState.channelId === oldState.channelId) return;

      const guildId = oldState.guild.id;
      const userId  = oldState.member?.id;
      if (!userId) return;

      const session = db.getActiveSession(guildId, oldState.channelId);
      if (!session) return;

      if (session.owner_user_id === userId) {
        logger.info('oyaji.vc.owner_left', { sessionId: session.session_id, userId });
        await handleSessionEnd(client, session, 'owner_left');
      }
    });

    logger.info('oyaji.feature.setup.complete');
  },
};
