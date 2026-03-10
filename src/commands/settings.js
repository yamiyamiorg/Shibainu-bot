// src/commands/settings.js
const { setNicknameMode } = require('../db/userRepo');

async function handleSettingsCommand(interaction, { dbPath }) {
    const choice = interaction.options.getString('nickname'); // on/off
    const nicknameMode = choice === 'on';

    const guildKey = interaction.guildId ?? interaction.channelId ?? 'DM';
    const userId = interaction.user.id;

    await setNicknameMode({ dbPath, userId, guildId: guildKey, nicknameMode });

    const msg = nicknameMode
        ? 'ぴえんども呼び、ONにしたよ🩷'
        : 'ぴえんども呼び、OFFにしたよ。呼び方はやさしめでいくね🌙';

    return msg;
}

module.exports = { handleSettingsCommand };
