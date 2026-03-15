// src/features/oyaji/index.js  v2
//
// 故郷のおやじBot - featureLoader エントリ。
//
// ── v2 の動作フロー ──────────────────────────────────────────────
//
//  /oyaji start
//    → 世代選択（エフェメラル Select Menu）
//    → 世代確定 → 専用スレッド生成
//    → 開始メッセージ（前回記憶を自然に混ぜる）
//    → 会話フックボタン（愚痴る/報告する/思い出話/なんとなく）表示
//
//  会話
//    → Botメンション (@oyaji テキスト)
//    → classify → templateMatch → Gemini fallback
//
//  タイムアウト
//    → setInterval(5分) でactiveセッションを走査
//    → last_interaction_at が SESSION_TIMEOUT_MS 以上前 → 自動終了
//
//  再起動フェイルセーフ
//    → ClientReady で recoverSessionsOnBoot()

'use strict';

const {
  Events,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');

const { logger }         = require('../../services/logger');
const { isFeatureEnabled } = require('../../utils/featureConfig');

const db = require('./oyajiDb');
const { classify }                        = require('./classifier');
const { matchTemplate, recordTemplateUsage } = require('./templateMatcher');
const { decideFallback, buildOyajiPrompt, fallbackReply } = require('./oyajiPersona');
const { generateContent } = require('../../services/gemini');

// ── 定数 ─────────────────────────────────────────────────────────

// セッションタイムアウト: 最後の発言からこの時間返信がなければ自動終了
const SESSION_TIMEOUT_MS    = 30 * 60 * 1000; // 30分
const TIMEOUT_CHECK_INTERVAL = 5 * 60 * 1000; // 5分ごとにチェック

// ── 世代定義 ─────────────────────────────────────────────────────

const LIFE_STAGES = [
  { id: 'childhood',     label: '幼少期',  emoji: '🧒', desc: '5歳ごろ。一緒に遊んでくれる若いおやじ。' },
  { id: 'elementary',    label: '小学生',  emoji: '📚', desc: '9歳ごろ。テストを一緒に喜んでくれる。' },
  { id: 'junior_high',   label: '中学生',  emoji: '🎒', desc: '15歳ごろ。不器用に励ましてくれる。' },
  { id: 'high_school',   label: '高校生',  emoji: '🌸', desc: '18歳ごろ。巣立ちを見守るおやじ。' },
  { id: 'college',       label: '大学生',  emoji: '🏙️', desc: '22歳ごろ。少し距離ができた頃。' },
  { id: 'working_adult', label: '社会人',  emoji: '💼', desc: '30歳ごろ。仕事の愚痴を聞いてくれる。' },
  { id: 'parent',        label: '親',      emoji: '👴', desc: '35歳ごろ。孫の話が嬉しくてたまらない。' },
];

function getStage(id) {
  return LIFE_STAGES.find((s) => s.id === id) || LIFE_STAGES[5];
}

// ── 開始メッセージ生成 ────────────────────────────────────────────
//
// 前回来訪の記憶があれば自然に混ぜる。
// 「この前は仕事の話してたな」のような短い一言を冒頭に添える。

const MEMORY_OPENERS = {
  work:           'この前は仕事の話してたな。',
  report_bad:     'この前はしんどそうだったな。',
  report_good:    'この前はいいことあったって言ってたべ。',
  exam:           'この前は受験の話してたな。',
  love_marriage:  'この前は恋の話してたべ。',
  family:         'この前は家族の話してたな。',
  homecoming:     'この前は帰省の話してたな。',
  child_parenting:'この前は子育ての話してたべ。',
  fatigue:        'この前も疲れてたな。',
  dream_future:   'この前は将来の話してたべ。',
  club:           'この前は部活の話してたな。',
};

const STAGE_OPENERS = {
  childhood:     ['お、来たが。今日はなにして遊ぶべ。', 'よしよし、来たな。こっちさ来い。'],
  elementary:    ['おう、帰ってきたか。学校どうだった。', '来たか。おやつあっぞ。'],
  junior_high:   ['おう。…遅かったな。まあいい、上がれ。', '来たか。部活か。まあ座れや。'],
  high_school:   ['おう、帰ってきたか。…飯あっか。', '来たな。…まあ、座れ。'],
  college:       ['おう、元気か。飯はちゃんとくってるか。', '来たか。…部屋、片してあっから。'],
  working_adult: ['おう、来たか。…まあ上がれ。飯あっか。', '久しぶりだな。母さんが心配してたぞ。'],
  parent:        ['おう、来たか。孫っこも一緒か。', '久しぶりだな。…元気そうで何よりだ。'],
};

function buildStartMessage(stage, profile, memories) {
  const openers = STAGE_OPENERS[stage.id] || STAGE_OPENERS['working_adult'];
  const opener  = openers[Math.floor(Math.random() * openers.length)];

  // 記憶がある場合は冒頭に一言添える
  let memoryLine = '';
  if (memories.length > 0 && profile?.session_count > 1) {
    const topMemory = memories[0];
    const memText   = MEMORY_OPENERS[topMemory.topic_category];
    if (memText) {
      memoryLine = `${memText}\n`;
    }
  }

  return `${memoryLine}${opener}`;
}

// ── 会話フックボタン ──────────────────────────────────────────────

function buildHookButtons(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`oyaji_hook:${sessionId}:grumble`)
      .setLabel('愚痴る')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`oyaji_hook:${sessionId}:report`)
      .setLabel('報告する')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`oyaji_hook:${sessionId}:memory`)
      .setLabel('思い出話')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`oyaji_hook:${sessionId}:idle`)
      .setLabel('なんとなく話す')
      .setStyle(ButtonStyle.Secondary),
  );
}

// フックボタンに対応するテンプレ入力テキスト
const HOOK_TEXTS = {
  grumble: 'ちょっと愚痴っていいか',
  report:  '聞いてほしいことがある',
  memory:  '昔の話をしたい',
  idle:    'なんとなく話したい',
};

// ── タイムアウト管理 ──────────────────────────────────────────────

let _timeoutTimer = null;

function startTimeoutChecker(client) {
  if (_timeoutTimer) return;

  _timeoutTimer = setInterval(async () => {
    try {
      await checkTimeouts(client);
    } catch (err) {
      logger.error('oyaji.timeout.check_error', { err: err?.message });
    }
  }, TIMEOUT_CHECK_INTERVAL);

  logger.info('oyaji.timeout.checker_started');
}

async function checkTimeouts(client) {
  const timedOut = db.getTimedOutSessions(SESSION_TIMEOUT_MS);
  for (const session of timedOut) {
    try {
      await handleSessionEnd(client, session, 'timeout');
    } catch (err) {
      logger.error('oyaji.timeout.end_error', { sessionId: session.session_id, err: err?.message });
    }
  }
}

// ── セッション終了 ────────────────────────────────────────────────

const SESSION_END_MESSAGES = [
  'んだばまた来いよ。おれはここにいっから。',
  'まあ、ゆっくりしてけ。またいつでも来い。',
  'そうか、またな。戸ぁ閉めてけよ。',
  'また来いよ。待っとるから。',
];

async function handleSessionEnd(client, session, reason = 'manual') {
  db.endSession(session.session_id);

  const channelId = session.thread_id || session.text_channel_id;
  const channel   = client.channels.cache.get(channelId);
  if (!channel) return;

  const msg = SESSION_END_MESSAGES[Math.floor(Math.random() * SESSION_END_MESSAGES.length)];
  try {
    await channel.send({ content: msg });
  } catch (err) {
    logger.warn('oyaji.session_end.send_failed', { reason, err: err?.message });
  }
}

// ── 会話生成 ──────────────────────────────────────────────────────

async function generateReply({ session, userId, userText }) {
  const { session_id, guild_id, current_stage } = session;

  // 分類
  const classifyResult = classify(userText, current_stage);

  // テンプレートマッチ
  const matchResult = matchTemplate({
    lifeStageId:       current_stage,
    primaryCategory:   classifyResult.primaryCategory,
    secondaryCategory: classifyResult.secondaryCategory,
    rank:              1, // v2ではrankは使わない（テンプレのmin/max rankは1-999にしてあるので全件対象）
    normalizedText:    classifyResult.normalizedText,
    sessionId:         session_id,
  });

  // Gemini fallback 判定
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
      const memories     = db.getRecentMemories(guild_id, userId);
      const interactions = db.getRecentInteractions(session_id, 3);
      const prompt = buildOyajiPrompt({
        userText,
        lifeStageId:        current_stage,
        category:           classifyResult.primaryCategory,
        recentMemories:     memories,
        recentInteractions: interactions,
      });
      responseText = await generateContent(prompt);
      usedAi = true;
    } catch (err) {
      logger.warn('oyaji.gemini.error', { err: err?.message });
      responseText = fallbackReply(current_stage);
    }
  }

  if (!responseText) responseText = fallbackReply(current_stage);

  // ログ・記憶・セッション更新
  db.logInteraction({ sessionId: session_id, userId, inputText: userText,
    category: classifyResult.primaryCategory, responseText, usedAi, templateId });
  db.touchSession(session_id);

  if (matchResult.template?.memory_effect?.write) {
    const me = matchResult.template.memory_effect;
    db.writeMemory({ guildId: guild_id, userId, topicCategory: me.category,
      summary: me.summary_template, importance: me.importance || 1 });
  }

  return responseText;
}

// ── /oyaji status テキスト ────────────────────────────────────────

function buildStatusText(guildId, userId) {
  const profile = db.getProfile(guildId, userId);
  const session = db.getActiveSession(guildId, userId);

  if (!profile && !session) {
    return 'まだおやじを呼んだことがないべ。`/oyaji start` で呼んでくれ。';
  }

  const lines = [];

  if (session) {
    const stage = getStage(session.current_stage);
    lines.push(`**いまの時代**: ${stage.emoji} ${stage.label}`);
    const idleMin = Math.floor((Date.now() - session.last_interaction_at) / 60000);
    lines.push(`**最後の会話**: ${idleMin}分前`);
    const remainMin = Math.max(0, Math.floor((SESSION_TIMEOUT_MS - (Date.now() - session.last_interaction_at)) / 60000));
    lines.push(`**タイムアウトまで**: あと${remainMin}分`);
  } else {
    lines.push('いまはセッションなし。`/oyaji start` で呼べる。');
  }

  if (profile) {
    lines.push(`**来訪回数**: ${profile.session_count}回`);
    if (profile.last_visit_at) {
      const d = new Date(profile.last_visit_at);
      lines.push(`**前回来訪**: ${d.toLocaleDateString('ja-JP')}`);
    }
  }

  return lines.join('\n');
}

// ── featureLoader エントリ ────────────────────────────────────────

module.exports = {
  name: 'oyaji',
  description: '故郷のおやじBot - 帰れる居間',

  enabled() {
    if (!process.env.GEMINI_API_KEY) return false;
    return isFeatureEnabled('oyaji');
  },

  async setup(client) {
    // テンプレートを起動時にロード
    require('./templateMatcher').getTemplateIndex();

    // ── 再起動フェイルセーフ ──────────────────────────────────────
    client.once(Events.ClientReady, async () => {
      try {
        const result = await db.recoverSessionsOnBoot(client);

        if (result.recovered > 0) {
          const recovered = db.getDb()
            .prepare(`SELECT * FROM oyaji_sessions WHERE status = 'active' AND restarted_at IS NOT NULL`)
            .all();

          for (const session of recovered) {
            const ch = client.channels.cache.get(session.thread_id || session.text_channel_id);
            if (!ch) continue;
            try { await ch.send('…おれも少し寝てたべ。続きやるか。'); } catch { /* ignore */ }
          }
        }
      } catch (err) {
        logger.error('oyaji.boot.recovery_error', { err: err?.message });
      }
    });

    // タイムアウトチェック開始
    startTimeoutChecker(client);

    // ── InteractionCreate ─────────────────────────────────────────

    client.on(Events.InteractionCreate, async (interaction) => {
      const userId  = interaction.user?.id;
      const guildId = interaction.guildId;
      if (!userId || !guildId) return;

      // ── /oyaji コマンド ────────────────────────────────────────
      if (interaction.isChatInputCommand() && interaction.commandName === 'oyaji') {
        const sub       = interaction.options.getSubcommand(false);
        const requestId = logger.makeRequestId?.() ?? `oyaji-${Date.now()}`;
        logger.info('oyaji.command', { requestId, sub, userId, guildId });

        try {
          // /oyaji start ─────────────────────────────────────────
          if (sub === 'start') {
            // 世代選択 Select Menu（エフェメラル）
            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`oyaji_stage_select:${userId}`)
              .setPlaceholder('会いたい時代のおやじを選んでください')
              .addOptions(
                LIFE_STAGES.map((s) => ({
                  label:       `${s.emoji} ${s.label}`,
                  description: s.desc,
                  value:       s.id,
                }))
              );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
              content:    'どの時代のおやじに会いたいか？',
              components: [row],
              flags:      MessageFlags.Ephemeral,
            });
            return;
          }

          // /oyaji status ────────────────────────────────────────
          if (sub === 'status') {
            await interaction.reply({
              content: buildStatusText(guildId, userId),
              flags:   MessageFlags.Ephemeral,
            });
            return;
          }

          // /oyaji leave ─────────────────────────────────────────
          if (sub === 'leave') {
            const session = db.getActiveSession(guildId, userId);
            if (!session) {
              await interaction.reply({ content: 'いまはセッションがないべ。', flags: MessageFlags.Ephemeral });
              return;
            }
            await handleSessionEnd(client, session, 'manual');
            await interaction.reply({ content: '…わかった。またいつでも来い。', flags: MessageFlags.Ephemeral });
            return;
          }

          // /oyaji help ──────────────────────────────────────────
          if (sub === 'help') {
            await interaction.reply({
              content: [
                '**故郷のおやじBot - 使い方**',
                '',
                '`/oyaji start` - おやじを呼ぶ（世代を選べる）',
                '`/oyaji status` - いまの状態を確認',
                '`/oyaji leave` - セッションを終わらせる',
                '',
                'おやじを呼んだあとは、スレッドで **@oyaji** とメンションして話しかけてね。',
                `無言が${SESSION_TIMEOUT_MS / 60000}分続くと自動的に帰るよ。`,
              ].join('\n'),
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

        } catch (err) {
          logger.error('oyaji.command.error', { requestId, sub, userId, guildId, err: err?.message });
          const msg = 'なんかうまくいかなかったべ。また話しかけてくれ。';
          try {
            if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
            else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
          } catch { /* ignore */ }
        }
        return;
      }

      // ── 世代選択 Select Menu ───────────────────────────────────
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(`oyaji_stage_select:${userId}`)
      ) {
        const selectedStage = interaction.values[0];
        const stage         = getStage(selectedStage);

        try {
          await interaction.deferUpdate();

          // スレッド名: 「おやじの居間 - username」
          const threadName = `おやじの居間 - ${interaction.user.username}`;

          // 既存のactiveセッションがあれば世代切替として扱う（DB側で旧セッションを終了）
          const session = db.startSession({
            guildId,
            userId,
            textChannelId: interaction.channelId,
            stage:         selectedStage,
          });

          // スレッドを作成または既存を再利用
          let thread;
          const existingThreadId = session.thread_id; // startSession後は null

          if (!existingThreadId) {
            try {
              thread = await interaction.channel.threads.create({
                name:                 threadName,
                autoArchiveDuration:  60, // 60分非活動でアーカイブ
              });
              db.updateSessionThread(session.session_id, thread.id);
            } catch (err) {
              // スレッド作成失敗時はチャンネル本体に送る
              logger.warn('oyaji.thread.create_failed', { err: err?.message });
              thread = interaction.channel;
            }
          } else {
            thread = client.channels.cache.get(existingThreadId) || interaction.channel;
          }

          // 記憶とプロフィールを取得して開始メッセージを生成
          const profile  = db.getProfile(guildId, userId);
          const memories = db.getRecentMemories(guildId, userId);
          const startMsg = buildStartMessage(stage, profile, memories);

          // 開始メッセージ + 会話フックボタン
          await thread.send({
            content:    startMsg,
            components: [buildHookButtons(session.session_id)],
          });

          // エフェメラルを更新
          await interaction.editReply({
            content:    `${stage.emoji} **${stage.label}**のおやじを呼んだよ。\n→ ${thread.toString()} で話しかけてね。`,
            components: [],
          });

          logger.info('oyaji.start.ok', {
            sessionId: session.session_id, guildId, userId, stage: selectedStage,
          });

        } catch (err) {
          logger.error('oyaji.stage_select.error', { userId, guildId, err: err?.message });
          try {
            await interaction.editReply({ content: 'うまくいかなかったべ。もう一度試してくれ。', components: [] });
          } catch { /* ignore */ }
        }
        return;
      }

      // ── 会話フックボタン ─────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('oyaji_hook:')) {
        const [, sessionId, hookType] = interaction.customId.split(':');
        const session = db.getSessionById(sessionId);

        // セッションが終了済みまたは別ユーザー
        if (!session || session.status !== 'active' || session.user_id !== userId) {
          await interaction.reply({ content: 'このセッションはもう終わったべ。', flags: MessageFlags.Ephemeral });
          return;
        }

        const userText = HOOK_TEXTS[hookType] || 'なんとなく話したい';

        try {
          await interaction.deferReply();
          const response = await generateReply({ session, userId, userText });
          const safe = response.length > 1900 ? response.slice(0, 1900) + '…' : response;
          await interaction.editReply(safe);
        } catch (err) {
          logger.error('oyaji.hook.error', { sessionId, hookType, err: err?.message });
          try { await interaction.editReply('うまく聞こえなかったべ。もう一度話しかけてくれ。'); } catch { /* ignore */ }
        }
        return;
      }
    });

    // ── MessageCreate: @oyaji メンションで会話 ───────────────────

    client.on(Events.MessageCreate, async (message) => {
      if (!message.guildId || message.author?.bot) return;

      const botUser = client.user;
      // Botへのメンションが含まれるか確認
      if (!message.mentions?.has(botUser)) return;

      const guildId = message.guildId;
      const userId  = message.author.id;

      // アクティブセッションを取得
      const session = db.getActiveSession(guildId, userId);
      if (!session) return; // セッションがない場合は無視

      // メンション部分を除いたテキスト
      const userText = (message.content || '')
        .replace(/<@!?\d+>/g, '')
        .trim();

      if (!userText) {
        // テキストなしのメンション → 軽く反応
        try {
          await message.reply({ content: '…なんか言ってみれ。', allowedMentions: { repliedUser: false } });
        } catch { /* ignore */ }
        return;
      }

      const requestId = logger.makeRequestId?.() ?? `oyaji-${Date.now()}`;
      logger.info('oyaji.mention', { requestId, userId, guildId, preview: userText.slice(0, 60) });

      try {
        await message.channel.sendTyping?.();
      } catch { /* ignore */ }

      try {
        const response = await generateReply({ session, userId, userText });
        const safe = response.length > 1900 ? response.slice(0, 1900) + '…' : response;
        await message.reply({ content: safe, allowedMentions: { repliedUser: false } });
        logger.info('oyaji.mention.ok', { requestId });
      } catch (err) {
        logger.error('oyaji.mention.error', { requestId, userId, err: err?.message });
        try {
          await message.reply({ content: 'うまく聞こえなかったべ。もう一度話しかけてくれ。', allowedMentions: { repliedUser: false } });
        } catch { /* ignore */ }
      }
    });

    logger.info('oyaji.feature.setup.complete');
  },
};
