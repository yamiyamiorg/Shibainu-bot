/**
 * src/features/boost/index.js
 *
 * - /boost_test type:ブースト開始|ブースト解除 でテスト実行
 * - 実際のブースト（guildMemberUpdate）でも同じ postBoostMessage() を使用
 * - deferReply() で「応答しませんでした」を防止
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBoostTargetsForGuild } = require('../../config/boostTarget');
const { logger } = require('../../services/logger');
const { hasMaintenanceAccess } = require('../../utils/maintenanceAccess');

// チャンネルを安全に取得
async function safeFetchTextChannel(client, channelId) {
  if (!channelId) return null;
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !('send' in ch)) return null;
    return ch;
  } catch {
    return null;
  }
}

// ブーストメッセージを組み立て
function buildBoostMessage(member, isBoosting, isTest) {
  const who = member?.user ? `<@${member.user.id}>` : '誰か';
  const body = isBoosting
    ? `${who}さん、ブーストありがとう！ めっちゃ助かる！音質・高画質配信が向上して、みんなでさらに楽しめそうです！これからもコミュニティを一緒に盛り上げていこうねー！`
    : `${who}さん、これまでのブーストありがとう！またいつでも戻ってきてね。`;
  return isTest ? `**【テスト】** ${body}` : body;
}

// ブースト通知を送信（テスト・本番共通）
async function postBoostMessage(client, guildId, member, isBoosting, isTest) {
  const tg = getBoostTargetsForGuild(guildId);

  logger.info('boost.post.start', {
    guildId,
    env: tg.env,
    channelId: tg.channelId,
    isBoosting,
    isTest,
  });

  if (!tg.channelId) {
    logger.error('boost.post.no_channel', { guildId, env: tg.env });
    return { ok: false, reason: 'no_channel_configured' };
  }

  const ch = await safeFetchTextChannel(client, tg.channelId);
  if (!ch) {
    logger.warn('boost.post.channel_unavailable', { guildId, channelId: tg.channelId });
    return { ok: false, reason: 'channel_unavailable' };
  }

  const text = buildBoostMessage(member, isBoosting, isTest);

  try {
    await ch.send({ content: text });
    logger.info('boost.post.ok', { guildId, channelId: tg.channelId, env: tg.env, isTest });
    return { ok: true };
  } catch (e) {
    logger.error('boost.post.send_failed', {
      guildId,
      channelId: tg.channelId,
      err: e?.message,
      code: e?.code,
    });
    return { ok: false, reason: 'send_failed' };
  }
}

// ブースト状態の変化を検知
function detectBoostChange(oldMember, newMember) {
  const oldTs = oldMember?.premiumSinceTimestamp ?? null;
  const newTs = newMember?.premiumSinceTimestamp ?? null;
  if (!oldTs && newTs) return { changed: true, isBoosting: true };
  if (oldTs && !newTs) return { changed: true, isBoosting: false };
  return { changed: false, isBoosting: null };
}

// /boost_test コマンド定義
const boostTestCmd = new SlashCommandBuilder()
  .setName('boost_test')
  .setDescription('ブースト通知のテスト（実際のブーストと同じ処理を実行）')
  .addStringOption(opt =>
    opt
      .setName('type')
      .setDescription('テストするタイプ')
      .setRequired(true)
      .addChoices(
        { name: 'ブースト開始', value: 'boost' },
        { name: 'ブースト解除', value: 'unboost' },
      )
  );

// interactionCreate ハンドラ
async function onInteractionCreate(interaction, client) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'boost_test') return;

  if (!hasMaintenanceAccess(interaction.user?.id, interaction.member)) {
    await interaction.reply({
      content: 'このコマンドを実行する権限がありません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const isBoosting = interaction.options.getString('type') === 'boost';

  logger.info('boost.test_cmd.received', {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    isBoosting,
  });

  const res = await postBoostMessage(
    client,
    interaction.guildId,
    interaction.member,
    isBoosting,
    true, // isTest
  );

  if (res.ok) {
    await interaction.editReply({ content: '✅ テスト成功！通知チャンネルを確認してね。' });
  } else {
    await interaction.editReply({
      content: `❌ 失敗しました (reason=${res.reason})\nログ: \`pm2 logs yamichan-bot | grep boost\``,
    });
  }
}

module.exports = {
  name: 'boost',
  description: 'Server boost notification',

  enabled() {
    const { isFeatureEnabled } = require('../../utils/featureConfig');
    return isFeatureEnabled('boost');
  },

  setup(client) {
    logger.info('boost.feature.setup');

    // 実際のブースト検知
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
      try {
        const { changed, isBoosting } = detectBoostChange(oldMember, newMember);
        if (!changed) return;

        logger.info('boost.real_event.detected', {
          guildId: newMember.guild?.id,
          memberId: newMember.id,
          isBoosting,
        });

        await postBoostMessage(client, newMember.guild?.id, newMember, isBoosting, false);
      } catch (e) {
        logger.error('boost.guildMemberUpdate.error', { err: e?.message });
      }
    });

    // テストコマンド
    client.on('interactionCreate', (interaction) => {
      onInteractionCreate(interaction, client).catch(e => {
        logger.error('boost.interaction.error', { err: e?.message });
      });
    });

    logger.info('boost.feature.setup.complete');
  },

  commands: [boostTestCmd.toJSON()],
};
