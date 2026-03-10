// src/utils/featureConfig.js
const fs = require('fs');
const path = require('path');
const { logger } = require('../services/logger');

const CONFIG_FILE = path.join(__dirname, '../../features.conf');

function loadFeatureConfig() {
  const config = {};

  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      logger.warn('featureConfig.file_not_found', {
        path: CONFIG_FILE,
        fallback: 'all disabled',
      });
      // ファイルが存在しない場合は空のconfigを返す。
      // isFeatureEnabled は未定義キーを false として扱うため、全機能OFFになる。
      return config;
    }

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
      if (match) {
        const [, featureName, rawValue] = match;
        const value = rawValue.trim();

        if (value.includes(':')) {
          const parts = value.split(':');
          const enabled = parts[0] === 'true';
          const env = parts[1] || 'test';
          config[featureName] = { enabled, env: env.toLowerCase() };
        } else {
          config[featureName] = { enabled: value === 'true', env: null };
        }
      }
    }

    logger.info('featureConfig.loaded_all', {
      file: CONFIG_FILE,
      features: Object.keys(config).length,
    });

  } catch (err) {
    logger.error('featureConfig.load_error', { err: err?.message, stack: err?.stack });
  }

  return config;
}

function isFeatureEnabled(featureName) {
  const config = loadFeatureConfig();
  // features.conf に記載がない（行が削除された）場合は安全側に倒して false を返す。
  // Codexなどの自動編集ツールが行を誤って消した場合も機能が暴走しない。
  if (!(featureName in config)) return false;
  const featureConfig = config[featureName];
  if (typeof featureConfig === 'object' && featureConfig !== null) {
    return featureConfig.enabled;
  }
  return !!featureConfig;
}

function getFeatureEnv(featureName) {
  const config = loadFeatureConfig();
  if (!(featureName in config)) return null;
  const featureConfig = config[featureName];
  if (typeof featureConfig === 'object' && featureConfig !== null) {
    return featureConfig.env || null;
  }
  return null;
}

function getConfigPath() { return CONFIG_FILE; }
function getAllFeatureConfig() { return loadFeatureConfig(); }

module.exports = {
  loadFeatureConfig,
  isFeatureEnabled,
  getFeatureEnv,
  getConfigPath,
  getAllFeatureConfig,
};
