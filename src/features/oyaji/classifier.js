// src/features/oyaji/classifier.js
//
// 入力テキストをカテゴリに分類するルールベースエンジン。
// 仕様書の「会話生成フロー」Step 1–3 に対応する。
//
// 処理フロー:
//   1. normalizeText()   - 入力の前処理
//   2. scoreCategories() - カテゴリ辞書でスコア付け
//   3. adjustByStage()   - 人生段階で補正
//   4. classify()        - 1–3 をまとめて返す

'use strict';

// ── カテゴリ辞書 ──────────────────────────────────────────────────
//
// keywords      - 1つでも含めば +2
// strong_keywords - 1つでも含めば +3（重要ワード）
// exclude_keywords - 含まれたら -3（誤爆防止）
// regex         - マッチで +3
// base_score    - 初期値（通常 0）
//

const CATEGORY_RULES = {
  greeting: {
    keywords: ['おはよう', 'こんにちは', 'こんばんは', 'ただいま', 'きた', '来た', 'おう', 'よっ', 'やあ'],
    strong_keywords: ['ただいま', 'おはよう'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
  report_good: {
    keywords: ['できた', 'うまくいった', '成功', '褒めて', 'ほめて', '勝った', '受かった', 'よかった', '嬉しい', 'うれしい'],
    strong_keywords: ['受かった', '褒めて', 'ほめて', '合格'],
    exclude_keywords: ['仕事', '残業'],
    regex: ['[89][0-9]点', '100点'],
    base_score: 0,
  },
  report_bad: {
    keywords: ['つらい', 'しんどい', 'だめ', '失敗', '怒られた', '疲れた', 'つかれた', 'へこんだ', '悲しい', 'かなしい', '泣いた', 'ないた'],
    strong_keywords: ['無理', '限界', '最悪', '消えたい', 'もう無理'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
  school: {
    keywords: ['学校', '授業', '先生', '給食', '休み時間', '宿題', '文化祭', '体育祭', '修学旅行'],
    strong_keywords: ['学校', '授業'],
    exclude_keywords: ['会社', '仕事'],
    regex: [],
    base_score: 0,
  },
  exam: {
    keywords: ['受験', '模試', 'テスト', '勉強', '偏差値', '試験', '入試'],
    strong_keywords: ['受験', '模試', '入試'],
    exclude_keywords: ['仕事', '会社'],
    regex: [],
    base_score: 0,
  },
  club: {
    keywords: ['部活', '試合', '練習', '先輩', '後輩', '大会', 'クラブ', 'コーチ', '顧問'],
    strong_keywords: ['部活', '大会'],
    exclude_keywords: ['会社', '上司'],
    regex: [],
    base_score: 0,
  },
  dream_future: {
    keywords: ['将来', '夢', '進路', '東京', '上京', '大学', 'どうしよう', 'なりたい', 'やりたい', 'したい'],
    strong_keywords: ['将来', '進路', '上京', '夢'],
    exclude_keywords: ['転職'],
    regex: [],
    base_score: 0,
  },
  work: {
    keywords: ['仕事', '会社', '上司', '残業', '転職', '出社', '会議', '給料', '職場', 'バイト', 'アルバイト', '就活'],
    strong_keywords: ['残業', '転職', '上司', '就活'],
    exclude_keywords: ['受験', '部活'],
    regex: [],
    base_score: 0,
  },
  love_marriage: {
    keywords: ['恋', '彼氏', '彼女', '好き', '結婚', '付き合', '告白', '振られた', 'フラれた', 'デート'],
    strong_keywords: ['結婚', '告白', 'プロポーズ'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
  family: {
    keywords: ['家族', '母さん', '父さん', '実家', '兄弟', '姉妹', 'お母さん', 'お父さん', 'きょうだい'],
    strong_keywords: ['実家', '家族'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
  child_parenting: {
    keywords: ['子ども', '育児', '保育園', '孫', '寝かしつけ', '子育て', '幼稚園', '出産', '赤ちゃん'],
    strong_keywords: ['育児', '子育て', '孫'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
  homecoming: {
    keywords: ['帰省', '帰る', '実家', '久しぶり', '戻る', 'お盆', '正月', 'ゴールデンウィーク'],
    strong_keywords: ['帰省', 'お盆', '正月'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
  fatigue: {
    keywords: ['眠い', 'ねむい', 'だるい', 'へとへと', '疲れた', 'つかれた', '休みたい', '寝たい'],
    strong_keywords: ['へとへと', '休みたい'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
  idle_chat: {
    keywords: ['ひま', 'なんでもない', '雑談', 'ねえ', '聞いて', 'なんか', 'どうしよ', 'ところで'],
    strong_keywords: ['ひま', '聞いて'],
    exclude_keywords: [],
    regex: [],
    base_score: 0,
  },
};

// ── 人生段階補正テーブル ─────────────────────────────────────────
//
// allow: そのまま使えるカテゴリ
// remap: 使えないカテゴリ → 代替カテゴリへのマッピング
// それ以外は idle_chat にフォールバック
//

const STAGE_POLICY = {
  childhood: {
    allow: ['greeting', 'report_good', 'report_bad', 'school', 'idle_chat', 'fatigue', 'family'],
    remap: {
      work: 'report_bad',
      love_marriage: 'idle_chat',
      child_parenting: 'family',
      exam: 'school',
      club: 'idle_chat',
      dream_future: 'idle_chat',
      homecoming: 'family',
    },
  },
  elementary: {
    allow: ['greeting', 'report_good', 'report_bad', 'school', 'exam', 'idle_chat', 'fatigue', 'family'],
    remap: {
      work: 'report_bad',
      love_marriage: 'idle_chat',
      child_parenting: 'family',
      club: 'school',
      homecoming: 'family',
      dream_future: 'idle_chat',
    },
  },
  junior_high: {
    allow: ['greeting', 'report_good', 'report_bad', 'school', 'exam', 'club',
            'dream_future', 'love_marriage', 'fatigue', 'idle_chat', 'family'],
    remap: {
      work: 'report_bad',
      child_parenting: 'family',
      homecoming: 'family',
    },
  },
  high_school: {
    allow: ['greeting', 'report_good', 'report_bad', 'school', 'exam', 'club',
            'dream_future', 'love_marriage', 'fatigue', 'idle_chat', 'family', 'homecoming'],
    remap: {
      work: 'report_bad',
      child_parenting: 'family',
    },
  },
  college: {
    allow: ['greeting', 'report_good', 'report_bad', 'school', 'exam', 'club',
            'dream_future', 'love_marriage', 'family', 'homecoming', 'fatigue', 'idle_chat', 'work'],
    remap: {
      child_parenting: 'family',
    },
  },
  working_adult: {
    allow: ['greeting', 'report_good', 'report_bad', 'work', 'love_marriage',
            'family', 'child_parenting', 'homecoming', 'fatigue', 'idle_chat', 'dream_future'],
    remap: {
      club: 'idle_chat',
      exam: 'report_bad',
      school: 'idle_chat',
    },
  },
  parent: {
    allow: ['greeting', 'report_good', 'report_bad', 'work', 'love_marriage',
            'family', 'child_parenting', 'homecoming', 'fatigue', 'idle_chat', 'dream_future'],
    remap: {
      club: 'idle_chat',
      exam: 'family',
      school: 'family',
    },
  },
};

// ── 前処理 ────────────────────────────────────────────────────────

/**
 * 入力テキストを正規化する。
 * - 全角英数字 → 半角
 * - 前後空白除去
 * - 小文字化
 * - 連続スペース圧縮
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text) return '';

  return text
    // 全角英数字→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    // 全角スペース→半角
    .replace(/　/g, ' ')
    // 前後空白
    .trim()
    // 小文字化
    .toLowerCase()
    // 連続スペース圧縮
    .replace(/\s+/g, ' ');
}

// ── スコアリング ──────────────────────────────────────────────────

/**
 * カテゴリ辞書に対してスコアを計算する。
 *
 * @param {string} normalizedText - normalizeText() 済みのテキスト
 * @returns {{ [category: string]: number }}
 */
function scoreCategories(normalizedText) {
  const scores = {};

  for (const [category, rule] of Object.entries(CATEGORY_RULES)) {
    let score = rule.base_score || 0;

    for (const kw of rule.keywords || []) {
      if (normalizedText.includes(kw)) score += 2;
    }

    for (const kw of rule.strong_keywords || []) {
      if (normalizedText.includes(kw)) score += 3;
    }

    for (const kw of rule.exclude_keywords || []) {
      if (normalizedText.includes(kw)) score -= 3;
    }

    for (const pattern of rule.regex || []) {
      try {
        if (new RegExp(pattern, 'i').test(normalizedText)) score += 3;
      } catch {
        // 壊れた正規表現は無視
      }
    }

    scores[category] = score;
  }

  return scores;
}

// ── 人生段階補正 ──────────────────────────────────────────────────

/**
 * カテゴリを人生段階のポリシーに従って補正する。
 *
 * @param {string} category
 * @param {string} lifeStageId
 * @returns {string} 補正後のカテゴリ
 */
function adjustByStage(category, lifeStageId) {
  if (category === 'unknown') return 'unknown';

  const policy = STAGE_POLICY[lifeStageId];
  if (!policy) return category;

  if (policy.allow.includes(category)) return category;
  if (policy.remap[category]) return policy.remap[category];

  return 'idle_chat';
}

// ── メイン分類関数 ────────────────────────────────────────────────

/**
 * @typedef {Object} ClassifyResult
 * @property {string}   primaryCategory   - 主カテゴリ
 * @property {string|null} secondaryCategory - 副カテゴリ（あれば）
 * @property {number}   primaryScore      - 主カテゴリのスコア
 * @property {string}   normalizedText    - 正規化済みテキスト
 * @property {{ [cat: string]: number }} scores - 全カテゴリのスコア
 * @property {'HIGH'|'MEDIUM'|'LOW'} confidence - 判定の確信度
 */

const CONFIDENCE_HIGH   = 8;  // このスコア以上は HIGH
const CONFIDENCE_MEDIUM = 3;  // このスコア以上は MEDIUM、未満は LOW

/**
 * テキストを分類する。
 *
 * @param {string} rawText       - ユーザー入力（生テキスト）
 * @param {string} lifeStageId   - 現在の人生段階 ID
 * @returns {ClassifyResult}
 */
function classify(rawText, lifeStageId) {
  const normalized = normalizeText(rawText);
  const rawScores = scoreCategories(normalized);

  // スコア降順にソート
  const sorted = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);

  const [primaryRaw, primaryScore] = sorted[0] || ['unknown', 0];
  const [secondaryRaw, secondaryScore] = sorted[1] || ['unknown', 0];

  // スコアが 0 以下なら unknown
  if (primaryScore <= 0) {
    return {
      primaryCategory: 'unknown',
      secondaryCategory: null,
      primaryScore: 0,
      normalizedText: normalized,
      scores: rawScores,
      confidence: 'LOW',
    };
  }

  // 人生段階補正
  const primary   = adjustByStage(primaryRaw,   lifeStageId);
  const secondary = secondaryScore > 0
    ? adjustByStage(secondaryRaw, lifeStageId)
    : null;

  // 確信度計算
  let confidence = 'LOW';
  if (primaryScore >= CONFIDENCE_HIGH) {
    confidence = 'HIGH';
  } else if (primaryScore >= CONFIDENCE_MEDIUM) {
    confidence = 'MEDIUM';
  }

  return {
    primaryCategory:   primary,
    secondaryCategory: secondary !== primary ? secondary : null,
    primaryScore,
    normalizedText:    normalized,
    scores:            rawScores,
    confidence,
  };
}

module.exports = {
  normalizeText,
  scoreCategories,
  adjustByStage,
  classify,
  CATEGORY_RULES,
  STAGE_POLICY,
};
