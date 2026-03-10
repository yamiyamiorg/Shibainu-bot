// src/features/welcome/vcNotifyHandler.js
const { logger } = require('../../services/logger');

/**
 * VC通知が可能かチェック
 */
function shouldNotifyVC(guideRoleId, notificationChannelId) {
  if (!guideRoleId) {
    logger.warn('welcome.vc_notify.no_guide_role');
    return false;
  }

  if (!notificationChannelId) {
    logger.warn('welcome.vc_notify.no_notification_channel');
    return false;
  }

  return true;
}

/**
 * VC参加を通知
 */
async function notifyVCJoin(newState, guideRoleId, notificationChannelId) {
  const member = newState.member;
  const guild = newState.guild;
  const channelName = newState.channel.name;

  try {
    // 通知先チャンネルを取得
    const notifyChannel = await guild.channels.fetch(notificationChannelId).catch(() => null);

    if (!notifyChannel) {
      logger.error('welcome.vc_notify.channel_not_found', {
        channelId: notificationChannelId,
      });
      return;
    }

    // サーバー参加日数計算
    const joinElapsed = Date.now() - member.joinedTimestamp;
    const joinDays = Math.floor(joinElapsed / (24 * 60 * 60 * 1000));

    // 通知メッセージ
    const message =
      `<@&${guideRoleId}> 🎤\n` +
      `新しいメンバー ${member} さんが **${channelName}** に参加しました！\n` +
      `（サーバー参加から ${joinDays} 日）`;

    await notifyChannel.send({
      content: message,
      allowedMentions: {
        roles: [guideRoleId],
      },
    });

    logger.info('welcome.vc_notify.sent', {
      userId: member.user.id,
      username: member.user.tag,
      channelId: newState.channelId,
      channelName,
      joinDays,
      notifiedTo: notificationChannelId,
    });

  } catch (err) {
    logger.error('welcome.vc_notify.send_error', {
      userId: member.user.id,
      channelId: newState.channelId,
      err: err?.message,
      stack: err?.stack,
    });
  }
}

module.exports = {
  shouldNotifyVC,
  notifyVCJoin,
};
