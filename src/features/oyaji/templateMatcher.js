// src/features/oyaji/templateMatcher.js
//
// テンプレートのロードとスコアリング。
// classify() の結果を受け取り、最適なテンプレートを1件返す。
//
// 選択フロー（仕様書「テンプレ選択ロジック」に準拠）:
//   1. life_stage + primaryCategory
//   2. life_stage + secondaryCategory
//   3. common + primaryCategory
//   4. common + secondaryCategory
//   5. life_stage + idle_chat
//   6. common + idle_chat
//   7. null（→ oyajiPersona.js の Gemini fallback へ）

'use strict';

const fs   = require('fs');
const path = require('path');
const { logger } = require('../../services/logger');

// ── テンプレートのロード ──────────────────────────────────────────
//
// 起動時に一度だけ読み込み、メモリに保持する。
// ファイルは data/oyaji/templates/ に置く。
//
// 現在は all_templates.json を 1 ファイルで運用。
// 将来的にステージごとのファイル分割も可能な設計にする。
//

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'oyaji', 'templates');

/** @type {{ [lifeStageId: string]: object[] }} */
let _templateIndex = null;

/**
 * テンプレートインデックスを返す（初回のみロード）。
 * @returns {{ [lifeStageId: string]: object[] }}
 */
function getTemplateIndex() {
  if (_templateIndex) return _templateIndex;

  _templateIndex = {};

  // ファイルが存在しない場合は空で返す（起動は止めない）
  if (!fs.existsSync(TEMPLATES_DIR)) {
    logger.warn('oyaji.templates.dir_not_found', { dir: TEMPLATES_DIR });
    return _templateIndex;
  }

  // JSON ファイルを全部読み込む
  const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
  let total = 0;

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
      const templates = JSON.parse(raw);

      for (const tpl of templates) {
        if (!tpl.life_stage) continue;
        if (!_templateIndex[tpl.life_stage]) {
          _templateIndex[tpl.life_stage] = [];
        }
        _templateIndex[tpl.life_stage].push(tpl);
        total++;
      }
    } catch (err) {
      logger.warn('oyaji.templates.load_error', { file, err: err?.message });
    }
  }

  logger.info('oyaji.templates.loaded', { total, stages: Object.keys(_templateIndex).length });
  return _templateIndex;
}

/**
 * テンプレートインデックスを強制リロードする（テスト・hot reload 用）。
 */
function reloadTemplates() {
  _templateIndex = null;
  return getTemplateIndex();
}

// ── クールダウン管理 ──────────────────────────────────────────────
//
// セッション内で同じテンプレートが連続で出ないようにする。
// key: `${sessionId}:${templateId}` → lastUsedAt (ms)
//

/** @type {Map<string, number>} */
const _cooldowns = new Map();

const COOLDOWN_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10分おとに古いエントリを掃除

setInterval(() => {
  const threshold = Date.now() - 5 * 60 * 1000; // 5分以上前のものを削除
  for (const [key, ts] of _cooldowns.entries()) {
    if (ts < threshold) _cooldowns.delete(key);
  }
}, COOLDOWN_CLEANUP_INTERVAL_MS);

/**
 * テンプレートがクールダウン中かどうかを確認する。
 * @param {string} sessionId
 * @param {string} templateId
 * @param {number} cooldownSec
 * @returns {boolean}
 */
function isCoolingDown(sessionId, templateId, cooldownSec) {
  if (!cooldownSec || cooldownSec <= 0) return false;
  const key = `${sessionId}:${templateId}`;
  const lastUsed = _cooldowns.get(key);
  if (!lastUsed) return false;
  return Date.now() - lastUsed < cooldownSec * 1000;
}

/**
 * テンプレートのクールダウンを記録する。
 * @param {string} sessionId
 * @param {string} templateId
 */
function recordUsage(sessionId, templateId) {
  _cooldowns.set(`${sessionId}:${templateId}`, Date.now());
}

// ── テンプレートスコアリング ──────────────────────────────────────

/**
 * テンプレート1件のスコアを計算する。
 * -Infinity を返すと選択対象外になる。
 *
 * @param {object} tpl         - テンプレートオブジェクト
 * @param {object} ctx         - マッチングコンテキスト
 * @param {number} ctx.rank    - 現在の rank
 * @param {string} ctx.normalizedText - 正規化済みテキスト
 * @param {string} ctx.sessionId
 * @returns {number}
 */
function scoreTemplate(tpl, ctx) {
  if (!tpl.enabled) return -Infinity;

  const minRank = tpl.conditions?.min_rank ?? 1;
  const maxRank = tpl.conditions?.max_rank ?? 999;
  if (ctx.rank < minRank || ctx.rank > maxRank) return -Infinity;

  if (isCoolingDown(ctx.sessionId, tpl.id, tpl.cooldown_sec)) return -Infinity;

  let score = tpl.priority || 0;
  const text = ctx.normalizedText || '';

  // keywords_any: 1つでも含めば +5
  for (const kw of tpl.input_keywords_any || []) {
    if (text.includes(kw)) score += 5;
  }

  // keywords_all: 全部含めば +10
  const allKws = tpl.input_keywords_all || [];
  if (allKws.length > 0 && allKws.every((kw) => text.includes(kw))) {
    score += 10;
  }

  // keywords_none: 含まれたら即アウト
  for (const kw of tpl.input_keywords_none || []) {
    if (text.includes(kw)) return -Infinity;
  }

  // regex: マッチで +7
  for (const pattern of tpl.input_regex || []) {
    try {
      if (new RegExp(pattern, 'i').test(text)) score += 7;
    } catch {
      // 壊れたパターンは無視
    }
  }

  return score;
}

// ── テンプレート選択メイン ────────────────────────────────────────

/**
 * @typedef {Object} MatchResult
 * @property {object|null} template   - 選択されたテンプレート（null なら Gemini fallback）
 * @property {string|null} templateId
 * @property {number}      score
 * @property {boolean}     hasMatch
 * @property {'HIGH'|'MEDIUM'|'LOW'} confidence
 * @property {string}      resolvedCategory - 実際に使ったカテゴリ
 */

/**
 * テンプレートを選択する。
 *
 * @param {object} params
 * @param {string} params.lifeStageId       - 現在の人生段階 ID
 * @param {string} params.primaryCategory   - 分類器の主カテゴリ
 * @param {string|null} params.secondaryCategory - 分類器の副カテゴリ
 * @param {number} params.rank              - 現在の rank
 * @param {string} params.normalizedText    - 正規化済みテキスト
 * @param {string} params.sessionId
 * @returns {MatchResult}
 */
function matchTemplate({
  lifeStageId,
  primaryCategory,
  secondaryCategory,
  rank,
  normalizedText,
  sessionId,
}) {
  const index = getTemplateIndex();
  const ctx = { rank, normalizedText, sessionId };

  // 検索順（仕様書の選択フローに準拠）
  const searchPlan = [
    { stage: lifeStageId, category: primaryCategory },
    { stage: lifeStageId, category: secondaryCategory },
    { stage: 'common',    category: primaryCategory },
    { stage: 'common',    category: secondaryCategory },
    { stage: lifeStageId, category: 'idle_chat' },
    { stage: 'common',    category: 'idle_chat' },
  ].filter((p) => p.category && p.stage);

  for (const { stage, category } of searchPlan) {
    const candidates = (index[stage] || []).filter((t) => t.category === category);
    if (candidates.length === 0) continue;

    // スコアリングして最高点を選ぶ
    let best = null;
    let bestScore = -Infinity;

    for (const tpl of candidates) {
      const s = scoreTemplate(tpl, ctx);
      if (s > bestScore) {
        bestScore = s;
        best = tpl;
      }
    }

    if (best && bestScore > -Infinity) {
      // responses からランダムに1つ選ぶ
      const responses = best.responses || [];
      const response = responses[Math.floor(Math.random() * responses.length)] || null;

      // 確信度計算（スコアベース）
      let confidence = 'LOW';
      if (bestScore >= 80) confidence = 'HIGH';
      else if (bestScore >= 50) confidence = 'MEDIUM';

      return {
        template:         best,
        templateId:       best.id,
        selectedResponse: response,
        score:            bestScore,
        hasMatch:         true,
        confidence,
        resolvedCategory: category,
      };
    }
  }

  // すべてのフォールバックが失敗
  return {
    template:         null,
    templateId:       null,
    selectedResponse: null,
    score:            0,
    hasMatch:         false,
    confidence:       'LOW',
    resolvedCategory: 'unknown',
  };
}

/**
 * テンプレート使用を記録する（クールダウン + メモリ書き込み）。
 * index.js の会話ハンドラから呼ぶ。
 *
 * @param {string} sessionId
 * @param {string} templateId
 */
function recordTemplateUsage(sessionId, templateId) {
  recordUsage(sessionId, templateId);
}

module.exports = {
  getTemplateIndex,
  reloadTemplates,
  matchTemplate,
  scoreTemplate,
  recordTemplateUsage,
};
