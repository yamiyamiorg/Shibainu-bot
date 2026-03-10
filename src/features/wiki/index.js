const { Events, EmbedBuilder, MessageFlags } = require('discord.js');
const { logger } = require('../../services/logger');

const DEFAULT_LANG = String(process.env.WIKI_DEFAULT_LANG || 'ja').trim().toLowerCase() || 'ja';
const MAX_DESCRIPTION = 3500;

function truncate(text, max = MAX_DESCRIPTION) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildSummaryUrl(lang, keyword) {
  return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(keyword)}`;
}

function buildArticleUrl(lang, titleOrKeyword) {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(titleOrKeyword)}`;
}

async function fetchWikiSummary(keyword, lang = DEFAULT_LANG) {
  const url = buildSummaryUrl(lang, keyword);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'yamichan-bot/2.3.2 (Discord Wikipedia summary bot)',
      'Accept': 'application/json',
    },
  });

  if (response.status === 404) {
    return { ok: false, kind: 'not_found' };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return {
      ok: false,
      kind: 'http_error',
      status: response.status,
      body: truncate(body, 300),
    };
  }

  const data = await response.json();

  if (!data || !data.extract) {
    return {
      ok: false,
      kind: data?.type === 'disambiguation' ? 'disambiguation' : 'no_extract',
      data,
    };
  }

  return { ok: true, data };
}

function buildSuccessEmbed(data, keyword, lang) {
  const title = data.title || keyword;
  const pageUrl = data.content_urls?.desktop?.page || buildArticleUrl(lang, title);
  const embed = new EmbedBuilder()
    .setColor(0x3366cc)
    .setTitle(`📚 ${title}`)
    .setURL(pageUrl)
    .setDescription(truncate(data.extract))
    .setFooter({ text: `${lang}.wikipedia.org` });

  if (data.thumbnail?.source) {
    embed.setThumbnail(data.thumbnail.source);
  }

  if (data.timestamp) {
    const ts = new Date(data.timestamp);
    if (!Number.isNaN(ts.getTime())) {
      embed.setTimestamp(ts);
    }
  }

  return embed;
}

module.exports = {
  name: 'wiki',
  description: 'Wikipedia summary slash command',

  enabled: () => {
    const { isFeatureEnabled } = require('../../utils/featureConfig');
    return isFeatureEnabled('wiki');
  },

  async setup(client) {
    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'wiki') return;

        const keyword = interaction.options.getString('keyword', true).trim();
        if (!keyword) {
          await interaction.reply({
            content: '調べたい言葉を入れてね。',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply();

        const result = await fetchWikiSummary(keyword, DEFAULT_LANG);

        if (!result.ok) {
          if (result.kind === 'not_found') {
            await interaction.editReply(`「${keyword}」の記事が見つからなかったよ。表記を変えてもう一度試してみてね。`);
            logger.info('wiki.not_found', {
              guildId: interaction.guildId,
              channelId: interaction.channelId,
              userId: interaction.user?.id,
              keyword,
              lang: DEFAULT_LANG,
            });
            return;
          }

          if (result.kind === 'disambiguation') {
            const pageUrl = result.data?.content_urls?.desktop?.page || buildArticleUrl(DEFAULT_LANG, keyword);
            await interaction.editReply(`「${keyword}」は候補が多いみたい。もう少し具体的にすると取れるかも。
${pageUrl}`);
            logger.info('wiki.disambiguation', {
              guildId: interaction.guildId,
              channelId: interaction.channelId,
              userId: interaction.user?.id,
              keyword,
              lang: DEFAULT_LANG,
            });
            return;
          }

          await interaction.editReply('Wikipediaの取得でエラーになったよ。少し待ってからもう一度試してね。');
          logger.warn('wiki.fetch.failed', {
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user?.id,
            keyword,
            lang: DEFAULT_LANG,
            kind: result.kind,
            status: result.status,
            body: result.body,
          });
          return;
        }

        const embed = buildSuccessEmbed(result.data, keyword, DEFAULT_LANG);
        await interaction.editReply({ embeds: [embed] });

        logger.info('wiki.success', {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user?.id,
          keyword,
          lang: DEFAULT_LANG,
          title: result.data?.title,
        });
      } catch (err) {
        logger.error('wiki.command.error', {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user?.id,
          err: err?.message,
          stack: err?.stack,
        });

        const content = 'Wikipediaの取得中にエラーが起きたよ。';
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, embeds: [] });
          } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
          }
        } catch (_) {}
      }
    });

    logger.info('wiki.feature.setup.complete', { lang: DEFAULT_LANG });
  },
};
