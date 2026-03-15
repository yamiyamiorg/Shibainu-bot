// src/features/oyaji/rankSystem.js
//
// おやじBotのランク・人生段階管理。
//
// ─── レベルカーブ設計 ───────────────────────────────────────────
//
//  子ども時代（幼少期〜高校生）: 20分/rank
//    → 関係をじっくり積み上げる。親子の時間は貴重。
//
//  大人以降（大学生〜）: 7分/rank
//    → 忙しい大人は帰省の頻度が短い分、関係が一気に動く。
//
//  段階ごとの必要時間（セッション累積分ベース）:
//
//    幼少期   rank 1–3   (3 ranks)  → 各20分  → 合計 60分
//    小学生   rank 4–8   (5 ranks)  → 各20分  → 合計 100分
//    中学生   rank 9–14  (6 ranks)  → 各20分  → 合計 120分
//    高校生   rank 15–20 (6 ranks)  → 各20分  → 合計 120分
//    大学生   rank 21–28 (8 ranks)  → 各 7分  → 合計  56分
//    社会人   rank 29–40 (12 ranks) → 各 7分  → 合計  84分
//    親       rank 41+              → 各 7分  → 上限なし
//
//  子ども期の総所要時間: 400分（≒6.7時間）  ← じっくりかかる
//  大人以降 rank 41 到達まで: +140分（≒2.3時間）
//  幼少期〜親まで総計: 約540分（≒9時間）
//
// ─────────────────────────────────────────────────────────────────

'use strict';

// ── ランクごとの必要分数 ──────────────────────────────────────────
//
// RANK_MINUTES_TABLE[rank] = そのランクに上がるために必要な追加分数
// rank 1 は開始時に付与されるので不要（0扱い）
//
const CHILD_PACE  = 20; // 分/rank（幼少期〜高校生）
const ADULT_PACE  =  7; // 分/rank（大学生〜）

const CHILD_RANKS  = { min: 1,  max: 20 }; // rank 1–20 が子ども期
const ADULT_RANKS  = { min: 21, max: Infinity }; // rank 21+ が大人期

/**
 * rank が子ども期かどうか
 * @param {number} rank
 * @returns {boolean}
 */
function isChildRank(rank) {
  return rank >= CHILD_RANKS.min && rank <= CHILD_RANKS.max;
}

/**
 * 次の rank に上がるために必要な分数を返す
 * @param {number} currentRank
 * @returns {number} 分数
 */
function minutesRequiredForNextRank(currentRank) {
  if (currentRank < CHILD_RANKS.max) return CHILD_PACE;
  return ADULT_PACE;
}

// ── 人生段階定義 ──────────────────────────────────────────────────

/**
 * @typedef {Object} LifeStage
 * @property {string} id        - 内部キー
 * @property {string} label     - 表示名
 * @property {number} minRank
 * @property {number} maxRank
 * @property {number} ageChild  - 主人公の年齢
 * @property {number} ageFather - 父親の年齢
 */

/** @type {LifeStage[]} */
const LIFE_STAGES = [
  { id: 'childhood',     label: '幼少期', minRank:  1, maxRank:  3, ageChild:  5, ageFather: 35 },
  { id: 'elementary',    label: '小学生', minRank:  4, maxRank:  8, ageChild:  9, ageFather: 39 },
  { id: 'junior_high',   label: '中学生', minRank:  9, maxRank: 14, ageChild: 15, ageFather: 45 },
  { id: 'high_school',   label: '高校生', minRank: 15, maxRank: 20, ageChild: 18, ageFather: 48 },
  { id: 'college',       label: '大学生', minRank: 21, maxRank: 28, ageChild: 22, ageFather: 52 },
  { id: 'working_adult', label: '社会人', minRank: 29, maxRank: 40, ageChild: 30, ageFather: 60 },
  { id: 'parent',        label: '親',    minRank: 41, maxRank: Infinity, ageChild: 35, ageFather: 65 },
];

/**
 * rank から LifeStage を返す
 * @param {number} rank
 * @returns {LifeStage}
 */
function getLifeStage(rank) {
  return (
    LIFE_STAGES.find((s) => rank >= s.minRank && rank <= s.maxRank) ||
    LIFE_STAGES[LIFE_STAGES.length - 1] // 念のため最後を返す
  );
}

/**
 * 次のランクアップまでの残り分数を計算する
 *
 * @param {number} currentRank
 * @param {number} totalMinutes  - 累積滞在分（DB の total_minutes）
 * @returns {number} 残り分数（0 以上）
 */
function minutesUntilNextRank(currentRank, totalMinutes) {
  // 現在の rank に到達するまでに必要だった累積分数
  const thresholdForCurrent = thresholdForRank(currentRank);
  // 次の rank に必要なペース
  const pace = minutesRequiredForNextRank(currentRank);
  // 次の rank の閾値
  const thresholdForNext = thresholdForCurrent + pace;

  return Math.max(0, thresholdForNext - totalMinutes);
}

/**
 * rank に到達するために必要な累積分数（rank 1 = 0 分）
 * @param {number} rank
 * @returns {number}
 */
function thresholdForRank(rank) {
  if (rank <= 1) return 0;

  let total = 0;
  for (let r = 1; r < rank; r++) {
    total += minutesRequiredForNextRank(r);
  }
  return total;
}

/**
 * 累積分数から現在の rank を計算する
 * セッション tick ごとに呼ぶ。
 *
 * @param {number} totalMinutes
 * @returns {number} rank（1 以上）
 */
function calcRankFromMinutes(totalMinutes) {
  let rank = 1;

  while (true) {
    const threshold = thresholdForRank(rank + 1);
    if (totalMinutes >= threshold) {
      rank++;
      // 親 (rank 41+) は上限なしで加算し続ける
      if (rank >= 41) {
        // rank 41 以降も 7分ごとに加算（/oyaji status の表示用）
        const extraMins = totalMinutes - thresholdForRank(41);
        const extraRanks = Math.floor(extraMins / ADULT_PACE);
        return 41 + extraRanks;
      }
    } else {
      break;
    }
  }

  return rank;
}

/**
 * /oyaji status 表示用のサマリーを返す
 *
 * @param {number} totalMinutes
 * @returns {{
 *   rank: number,
 *   lifeStage: LifeStage,
 *   minutesUntilNext: number,
 *   totalMinutes: number,
 *   totalHours: string,
 * }}
 */
function getStatusSummary(totalMinutes) {
  const rank = calcRankFromMinutes(totalMinutes);
  const lifeStage = getLifeStage(rank);
  const minutesUntilNext = minutesUntilNextRank(rank, totalMinutes);

  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const totalHours = `${h}時間${m}分`;

  return { rank, lifeStage, minutesUntilNext, totalMinutes, totalHours };
}

module.exports = {
  LIFE_STAGES,
  CHILD_PACE,
  ADULT_PACE,
  getLifeStage,
  calcRankFromMinutes,
  minutesUntilNextRank,
  thresholdForRank,
  minutesRequiredForNextRank,
  getStatusSummary,
};
