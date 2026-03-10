// src/services/logger.js
const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function envBool(name, def = false) {
  const v = process.env[name];
  if (v == null) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function getLevel() {
  const raw = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  return LEVELS[raw] ? raw : 'info';
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return JSON.stringify({ msg: 'json_stringify_failed', err: String(e) });
  }
}

function makeRequestId() {
  // 依存なしで軽い相関ID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createLogger() {
  const levelName = getLevel();
  const minLevel = LEVELS[levelName];
  const json = envBool('LOG_JSON', true);

  const toFile = envBool('LOG_TO_FILE', true);
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  const logFile = process.env.LOG_FILE || path.join(logDir, 'app.log');

  if (toFile) ensureDir(logDir);

  function writeLine(line) {
    // console
    console.log(line);

    // file
    if (toFile) {
      try {
        fs.appendFileSync(logFile, line + '\n', 'utf8');
      } catch (e) {
        // 最悪、ファイルに書けなくても落とさない
        console.error('[logger] failed to append file:', e?.message || e);
      }
    }
  }

  function emit(level, event, data = {}) {
    if (LEVELS[level] < minLevel) return;

    const base = {
      ts: nowIso(),
      level,
      event,
      ...data,
    };

    if (json) {
      writeLine(safeJson(base));
    } else {
      // 人間向け
      const tail = Object.keys(data).length ? ` ${safeJson(data)}` : '';
      writeLine(`[${base.ts}] ${level.toUpperCase()} ${event}${tail}`);
    }
  }

  return {
    makeRequestId,
    debug: (event, data) => emit('debug', event, data),
    info: (event, data) => emit('info', event, data),
    warn: (event, data) => emit('warn', event, data),
    error: (event, data) => emit('error', event, data),
  };
}

const logger = createLogger();

module.exports = { logger };
