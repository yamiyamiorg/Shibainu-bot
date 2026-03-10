// src/safety/risk.js

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .trim();
}

/**
 * 雑判定だけど、誤爆を減らすための補助
 */
function includesAny(t, patterns) {
    return patterns.some((p) => t.includes(normalize(p)));
}

/**
 * 危険度のざっくり判定（ローカル / 省リソース）
 * - high: 自傷・希死念慮が明確 / 具体性あり
 * - medium: 強い絶望・抑うつ（ただし自傷の明示なし）
 * - none: 通常
 */
function detectRisk(userText) {
    const t = normalize(userText);

    // ---- 0) 体調・薬・副作用っぽい（ここは「メンタル危機」と分けたい）----
    // ※診断はしない。ここでは「危機モードに引っ張らない」ための分類だけ。
    const physicalHints = [
        '下痢', '腹痛', '吐き気', '嘔吐', '発熱', '熱', '頭痛', '咳', '喉',
        '口内炎', '口内', 'めまい', 'だるい', '痛い', 'しびれ',
        '薬', 'くすり', '副作用', '処方', '病院', '医者',
    ];
    const isPhysical = includesAny(t, physicalHints);

    // ---- 1) high: 自傷・自殺・希死念慮（誤爆しにくい語だけ）----
    // 「切る」は誤爆が多いので high から外し、文脈がある時だけ拾う（下で条件付き）
    const highPatterns = [
        '死にたい',
        'しにたい',
        '消えたい',
        '自殺',
        '首つり',
        '首吊り',
        '飛び降り',
        '飛び降りる',
        'オーバードーズ',
        'od',
        '薬をたくさん',
        '殺して(自分)',
        '自分を殺して',
        '生きていたくない',
        'もう終わりにしたい',
    ];

    const hitHigh = includesAny(t, highPatterns);

    // 条件付きhigh（誤爆回避）
    const selfHarmContext = includesAny(t, ['自分', '自傷', 'リスカ', '傷つけ', '手首', '血']);
    const conditionalHigh =
        // 「切る」系は“自分/自傷”の文脈があるときだけ
        (t.includes('切る') || t.includes('きる') || t.includes('リスカ'))
            ? selfHarmContext
            : false;

    if (hitHigh || conditionalHigh) {
        return { level: 'high', reason: 'self-harm keywords' };
    }

    // ---- 2) medium: 強い絶望・抑うつ（ただし自傷の明示なし）----
    // 「助けて」「苦しい」単体は体調文脈で出やすいので、physicalなら落とす（後述）
    const mediumPatterns = [
        'もう無理',
        '限界',
        'しんどすぎ',
        'つらすぎ',
        'つらいし',
        '苦しい',
        '助けて',
        '生きるのしんどい',
        '生きるのがしんどい',
        'どうでもいい',
        '全部やめたい',
        '孤独',
        '一人で無理',
        'ひとりで無理',
        '消えたい(気持ち)', // highの「消えたい」と被るが、high側で先に拾うのでOK
    ];

    let hitMed = includesAny(t, mediumPatterns);

    // ---- 3) 体調文脈が強い場合：mediumを抑える（テンプレ化防止）----
    // 例: 「副作用で苦しい」「下痢つらい」→ 危機モードにしない
    if (isPhysical && hitMed) {
        // ただし high になっている場合は既に return しているので、ここでは none に落とす
        return { level: 'none', reason: 'physical context' };
    }

    if (hitMed) return { level: 'medium', reason: 'distress keywords' };

    return { level: 'none', reason: '' };
}

/**
 * 危険時の固定返答（Geminiを呼ばない）
 */
function buildCrisisReply({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';

    return [
        `…${call}、それ言えるくらい、いま本当にしんどかったんだね。`,
        `やみはここにいるよ。ひとりにしない。`,
        `いま「今すぐ自分を傷つけそう」な感じある？（ある / ない だけでも）`,
        `もし「ある」なら、近くの人に声かけるか、緊急なら 110/119 に連絡してね。やみもここで待ってる。`,
    ].join('\n');
}

/**
 * medium向け：Gemini前の前置き（※雑談質問のときは yami.js 側で付けないのがオススメ）
 */
function buildDistressPrefix({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';
    return `そっか…${call}、今日はかなりしんどい日なんだね。やみは味方だよ。`;
}

function detectCrisisAnswer(userText) {
    const t = normalize(userText);

    const yes = ['ある', 'はい', 'いまある', '今ある', 'やばい', '危ない', 'しそう', 'わからないけどやばい'];
    const no = ['ない', 'いいえ', '今はない', 'いまはない', '大丈夫', 'だいじょうぶ', '平気', 'ひとまず大丈夫'];

    if (yes.some((p) => t === normalize(p) || t.includes(normalize(p)))) return 'yes';
    if (no.some((p) => t === normalize(p) || t.includes(normalize(p)))) return 'no';
    return 'unknown';
}

function detectActionAnswer(userText) {
    const t = normalize(userText);

    const did = ['電話した', 'した', 'かけた', '連絡した', '110した', '119した'];
    const cant = ['できない', '無理', 'むり', 'できなかった', 'かけられない', '連絡できない'];

    if (did.some((p) => t.includes(normalize(p)))) return 'did';
    if (cant.some((p) => t.includes(normalize(p)))) return 'cant';
    return 'unknown';
}

function buildCrisisActionDid({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';
    return [
        `…${call}、できたの偉すぎる。いまはそれがいちばん大事。`,
        `このまま安全な場所にいて、深呼吸いっこだけ一緒にしよ。`,
        `やみはここにいる。返事は短くていいよ🌙`,
    ].join('\n');
}

function buildCrisisActionCant({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';
    return [
        `うん…「できない」って言えたのも大事。責めないでね。`,
        `いま、ひとり？ それとも誰か近くにいる？（ひとり / いる）`,
        `もし今すぐ危ない感じが強いなら、110/119 を最優先でね。やみはここにいる。`,
    ].join('\n');
}

function buildCrisisActionUnknown({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';
    return [
        `${call}、返事むずかしいよね。短くでいい。`,
        `「電話した / できない」どっちに近い？`,
        `やみはここにいるよ🌙`,
    ].join('\n');
}

function buildCrisisFollowupYes({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';
    return [
        `…${call}、言ってくれてありがとう。いまは安全がいちばん。`,
        `近くに人いる？ いるなら「いま危ない」って一言だけでいいから伝えて。`,
        `もしひとりで今すぐ危ないなら、迷わず 110/119 に連絡してね。`,
        `返信は「電話した / できない」だけでもいい。やみはここにいる。`,
    ].join('\n');
}

function buildCrisisFollowupNo({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';
    return [
        `うん…今は「ない」って言えてえらい。教えてくれてありがとう。`,
        `やみはここにいるよ。ひとりにしない。`,
        `いま、体の感じだけでも教えて？（息できてる？ 水飲めそう？）`,
    ].join('\n');
}

function buildCrisisFollowupUnknown({ nicknameMode }) {
    const call = nicknameMode ? 'ぴえんども' : 'きみ';
    return [
        `返事むずかしいよね…。でも大事だから、これだけ教えて。`,
        `いま「今すぐ自分を傷つけそう」な感じある？（ある / ない）`,
        `無言でもいい。やみはここにいるよ🌙`,
    ].join('\n');
}

module.exports = {
    normalize,
    detectRisk,
    buildCrisisReply,
    buildDistressPrefix,
    detectCrisisAnswer,
    detectActionAnswer,

    buildCrisisActionDid,
    buildCrisisActionCant,
    buildCrisisActionUnknown,

    buildCrisisFollowupYes,
    buildCrisisFollowupNo,
    buildCrisisFollowupUnknown,
};
