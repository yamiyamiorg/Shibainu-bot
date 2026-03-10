// src/features/health/index.js
const { Events, EmbedBuilder } = require('discord.js');
const { logger } = require('../../services/logger');
const fs = require('fs/promises');
const path = require('path');

// 起動時刻を記録
const startTime = Date.now();

module.exports = {
  name: 'health',
  description: 'Bot health and status monitoring',

  enabled: () => {
    // features.conf チェック
    const { isFeatureEnabled } = require('../../utils/featureConfig');
    return isFeatureEnabled('health');
  },

  async setup(client) {
    // /status コマンド
    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'status') return;

        await interaction.deferReply();

        // 稼働時間計算
        const uptime = Date.now() - startTime;
        const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
        const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

        const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;

        // メモリ使用量
        const memUsage = process.memoryUsage();
        const memMB = {
          rss: (memUsage.rss / 1024 / 1024).toFixed(2),
          heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
          heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
        };

        // 有効な機能を確認
        const featuresDir = path.join(__dirname, '..');
        const featureList = [];
        
        try {
          const entries = await fs.readdir(featuresDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            try {
              const feature = require(path.join(featuresDir, entry.name, 'index.js'));
              const isEnabled = !feature.enabled || feature.enabled();
              if (isEnabled && feature.name !== 'health') {
                featureList.push(`✅ ${feature.name}`);
              }
            } catch (e) {
              // スキップ
            }
          }
        } catch (e) {
          logger.warn('health.features.scan.failed', { err: e?.message });
        }

        // Embed作成
        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('🤖 Bot Status')
          .addFields(
            { name: '⏱️ Uptime', value: uptimeStr, inline: true },
            { name: '📊 Memory (RSS)', value: `${memMB.rss} MB`, inline: true },
            { name: '💾 Heap Used', value: `${memMB.heapUsed} MB`, inline: true },
            { name: '🔧 Features', value: featureList.join('\n') || 'なし', inline: false },
            { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true },
            { name: '🏷️ Node.js', value: process.version, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        logger.info('health.status.shown', {
          userId: interaction.user.id,
          guildId: interaction.guildId,
        });
      } catch (err) {
        logger.error('health.status.error', { err: err?.message });
        try {
          const content = '⚠️ ステータス取得に失敗しました';
          if (interaction.deferred) {
            await interaction.editReply(content);
          } else {
            await interaction.reply(content);
          }
        } catch (e) {
          // 無視
        }
      }
    });

    logger.info('health.feature.setup.complete');
  },
};
