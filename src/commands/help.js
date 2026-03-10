// src/commands/help.js
function handleHelpCommand() {
    return [
        'はろーぶぃぶぃ。やみちゃんbotだよ🌙',
        '',
        '使い方:',
        '・/yami （話しかける）',
        '・/yamihelp （これ）',
        '・/yamisettings nickname: on/off（ぴえんども呼び切替）',
        '',
        '無言でもいいから、ここにいて。',
    ].join('\n');
}

module.exports = { handleHelpCommand };
