// src/core/featureLoader.js
const fs = require('fs/promises');
const path = require('path');
const { logger } = require('../services/logger');

/**
 * 各機能モジュールの構造:
 * {
 *   name: string,
 *   description?: string,
 *   setup: (client) => Promise<void>,
 *   enabled?: () => boolean
 * }
 */

async function loadFeatures(client) {
  const featuresDir = path.join(__dirname, '../features');
  const features = [];
  const OMITTED_FEATURES = new Set(['yami', 'boost', 'serverstats']);

  try {
    const entries = await fs.readdir(featuresDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (OMITTED_FEATURES.has(entry.name)) {
        logger.info('feature.omitted', { name: entry.name, reason: 'migrated_to_other_bot' });
        continue;
      }

      const featurePath = path.join(featuresDir, entry.name, 'index.js');

      try {
        // ファイルの存在確認
        await fs.access(featurePath);

        // 機能モジュールを読み込み
        const feature = require(featurePath);

        logger.info('feature.processing', { name: entry.name, featureName: feature.name });

        // enabled チェック
        if (feature.enabled && !feature.enabled()) {
          logger.info('feature.disabled', { name: feature.name || entry.name });
          continue;
        }

        // setup実行
        if (typeof feature.setup === 'function') {
          await feature.setup(client);
          features.push(feature);
          logger.info('feature.loaded', {
            name: feature.name,
            description: feature.description
          });
        } else {
          logger.warn('feature.invalid', {
            name: entry.name,
            reason: 'Missing setup function'
          });
        }
      } catch (err) {
        // 機能の読み込み失敗は警告のみで継続
        logger.warn('feature.load.failed', {
          name: entry.name,
          err: err?.message
        });
      }
    }
  } catch (err) {
    logger.error('features.load.error', { err: err?.message });
  }

  try {
    client.loadedFeatureNames = features
      .map((f) => String(f?.name || '').trim())
      .filter(Boolean);
  } catch (err) {
    logger.warn('features.loaded_names.set_failed', { err: err?.message });
  }

  return features;
}

module.exports = { loadFeatures };
