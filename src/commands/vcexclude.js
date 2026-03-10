// src/commands/vcexclude.js
/**
 * /vcexclude コマンド
 *
 * VC推薦・賑わい通知から除外するチャンネルをコマンドで管理する。
 *
 * サブコマンド:
 *   /vcexclude add    #channel [reason]  — 除外リストに追加
 *   /vcexclude remove #channel           — 除外リストから削除
 *   /vcexclude list                      — 除外リストを表示
 *
 * 権限: MANAGE_GUILD（サーバー管理者のみ）
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require('discord.js');
const {
    addExcludedId,
    removeExcludedId,
    listExcludedIds,
    loadExcludedIds,
} = require('../features/serverstats/vcNotifier');

const REASON_CHOICES = [
    { name: '内部専用（部室・部署チャンネルなど）', value: '内部専用' },
    { name: '作業部屋（もくもく・集中作業）',       value: '作業部屋' },
    { name: '招待制（限定メンバーのみ）',           value: '招待制'   },
    { name: 'その他',                               value: 'その他'   },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vcexclude')
        .setDescription('VC賑わい通知・おすすめ表示の除外チャンネルを管理します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('チャンネルを除外リストに追加します')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('除外するVCチャンネル')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('reason')
                        .setDescription('除外理由')
                        .setRequired(false)
                        .addChoices(...REASON_CHOICES)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('remove')
                .setDescription('チャンネルを除外リストから削除します')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('除外を解除するVCチャンネル')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('現在の除外チャンネル一覧を表示します')
        ),

    async execute(interaction) {
        if (!interaction.guildId) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        // ── add ──────────────────────────────────────────────────────────
        if (sub === 'add') {
            const channel = interaction.options.getChannel('channel');
            const reason  = interaction.options.getString('reason') || 'その他';

            await interaction.deferReply({ ephemeral: true });

            try {
                await addExcludedId(
                    interaction.guildId,
                    channel.id,
                    channel.name,
                    reason
                );
                // メモリキャッシュを再ロード
                await loadExcludedIds(interaction.guildId);

                const embed = new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle('✅ 除外チャンネルを追加しました')
                    .addFields(
                        { name: 'チャンネル', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
                        { name: '除外理由',   value: reason,                                    inline: true }
                    )
                    .setFooter({ text: 'このチャンネルはVC賑わい通知・おすすめ表示に出なくなります' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                return interaction.editReply({ content: `エラーが発生しました: ${err?.message}` });
            }
        }

        // ── remove ───────────────────────────────────────────────────────
        if (sub === 'remove') {
            const channel = interaction.options.getChannel('channel');

            await interaction.deferReply({ ephemeral: true });

            try {
                await removeExcludedId(interaction.guildId, channel.id);
                await loadExcludedIds(interaction.guildId);

                const embed = new EmbedBuilder()
                    .setColor(0xfee75c)
                    .setTitle('🗑️ 除外チャンネルを削除しました')
                    .setDescription(`<#${channel.id}> (\`${channel.name}\`) を除外リストから削除しました。\nVC賑わい通知・おすすめ表示に再び表示されます。`)
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                return interaction.editReply({ content: `エラーが発生しました: ${err?.message}` });
            }
        }

        // ── list ─────────────────────────────────────────────────────────
        if (sub === 'list') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const rows = await listExcludedIds(interaction.guildId);

                if (rows.length === 0) {
                    return interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x5865f2)
                                .setTitle('📋 除外チャンネル一覧')
                                .setDescription('DB管理の除外チャンネルはありません。\n（コードに直接書かれたIDは引き続き有効です）')
                                .setTimestamp(),
                        ],
                    });
                }

                const lines = rows.map((r) => {
                    const ts = `<t:${r.added_at}:d>`;
                    return `• <#${r.channel_id}> \`${r.label || r.channel_id}\` — ${r.reason || 'その他'} (追加: ${ts})`;
                });

                const embed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle(`📋 除外チャンネル一覧 (${rows.length}件)`)
                    .setDescription(lines.join('\n'))
                    .setFooter({ text: 'これらのチャンネルはVC賑わい通知・おすすめ表示に出ません' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                return interaction.editReply({ content: `エラーが発生しました: ${err?.message}` });
            }
        }
    },
};
