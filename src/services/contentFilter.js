// src/services/contentFilter.js
const { logger } = require('./logger');

// ユーザーごとのレート制限
const userRateLimits = new Map();

// スパム判定の設定
const SPAM_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 5,
  MAX_REQUESTS_PER_HOUR: 30,
  COOLDOWN_MS: 2000, // 連続リクエストの最小間隔
  BAN_DURATION_MS: 3600000, // 1時間
};

// 禁止ワードリスト（実際の運用では外部ファイルやDBから読み込む）
const BANNED_WORDS = [
  // 差別的な表現
  // ハラスメント関連
  // 個人情報関連のパターン
  // 必要に応じて追加
];

// URLパターン（スパムリンク検出用）
const SUSPICIOUS_URL_PATTERNS = [
  /bit\.ly/i,
  /discord\.gg\/[a-zA-Z0-9]{6,}/i, // 招待リンク
  /free.*nitro/i,
  /free.*discord/i,
];

/**
 * レート制限チェック
 */
function checkRateLimit(userId) {
  const now = Date.now();
  
  if (!userRateLimits.has(userId)) {
    userRateLimits.set(userId, {
      requests: [],
      lastRequest: 0,
      banned: false,
      banUntil: 0,
    });
  }

  const userData = userRateLimits.get(userId);

  // BAN中かチェック
  if (userData.banned) {
    if (now < userData.banUntil) {
      return {
        allowed: false,
        reason: 'banned',
        remainingMs: userData.banUntil - now,
      };
    } else {
      // BAN解除
      userData.banned = false;
      userData.requests = [];
    }
  }

  // クールダウンチェック
  if (now - userData.lastRequest < SPAM_CONFIG.COOLDOWN_MS) {
    return {
      allowed: false,
      reason: 'cooldown',
      remainingMs: SPAM_CONFIG.COOLDOWN_MS - (now - userData.lastRequest),
    };
  }

  // 古いリクエストを削除（1時間以上前）
  userData.requests = userData.requests.filter(
    (timestamp) => now - timestamp < 3600000
  );

  // 1分間のリクエスト数チェック
  const recentRequests = userData.requests.filter(
    (timestamp) => now - timestamp < 60000
  );
  if (recentRequests.length >= SPAM_CONFIG.MAX_REQUESTS_PER_MINUTE) {
    // スパム判定 -> BAN
    userData.banned = true;
    userData.banUntil = now + SPAM_CONFIG.BAN_DURATION_MS;
    logger.warn('spam.detected.rate_limit', {
      userId,
      requestsPerMin: recentRequests.length,
      banUntil: new Date(userData.banUntil).toISOString(),
    });
    return {
      allowed: false,
      reason: 'spam_detected',
      bannedUntil: userData.banUntil,
    };
  }

  // 1時間のリクエスト数チェック
  if (userData.requests.length >= SPAM_CONFIG.MAX_REQUESTS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'hourly_limit',
      remainingMs: 3600000 - (now - userData.requests[0]),
    };
  }

  // リクエストを記録
  userData.requests.push(now);
  userData.lastRequest = now;

  return { allowed: true };
}

/**
 * コンテンツフィルタリング
 */
function checkContent(content) {
  if (!content || typeof content !== 'string') {
    return { allowed: true };
  }

  const lowerContent = content.toLowerCase();

  // 禁止ワードチェック
  for (const word of BANNED_WORDS) {
    if (lowerContent.includes(word.toLowerCase())) {
      logger.warn('content.banned_word', { word });
      return {
        allowed: false,
        reason: 'banned_word',
        detail: '不適切な言葉が含まれています',
      };
    }
  }

  // 疑わしいURLチェック
  for (const pattern of SUSPICIOUS_URL_PATTERNS) {
    if (pattern.test(content)) {
      logger.warn('content.suspicious_url', { pattern: pattern.source });
      return {
        allowed: false,
        reason: 'suspicious_url',
        detail: '疑わしいリンクが含まれています',
      };
    }
  }

  // 長すぎるメッセージ（DoS対策）
  if (content.length > 2000) {
    return {
      allowed: false,
      reason: 'too_long',
      detail: 'メッセージが長すぎます',
    };
  }

  // 同じ文字の繰り返し（スパム）
  const repeatedPattern = /(.)\1{20,}/;
  if (repeatedPattern.test(content)) {
    return {
      allowed: false,
      reason: 'repeated_chars',
      detail: '不自然な繰り返しが検出されました',
    };
  }

  return { allowed: true };
}

/**
 * 統合チェック
 */
function checkRequest(userId, content) {
  // レート制限チェック
  const rateLimitResult = checkRateLimit(userId);
  if (!rateLimitResult.allowed) {
    return rateLimitResult;
  }

  // コンテンツチェック
  const contentResult = checkContent(content);
  if (!contentResult.allowed) {
    return contentResult;
  }

  return { allowed: true };
}

/**
 * BANを手動で解除
 */
function unbanUser(userId) {
  if (userRateLimits.has(userId)) {
    const userData = userRateLimits.get(userId);
    userData.banned = false;
    userData.banUntil = 0;
    userData.requests = [];
    logger.info('spam.user.unbanned', { userId });
  }
}

/**
 * 統計情報取得
 */
function getStats() {
  const stats = {
    totalUsers: userRateLimits.size,
    bannedUsers: 0,
    activeUsers: 0,
  };

  const now = Date.now();
  for (const [userId, userData] of userRateLimits.entries()) {
    if (userData.banned && now < userData.banUntil) {
      stats.bannedUsers++;
    }
    if (userData.requests.length > 0) {
      stats.activeUsers++;
    }
  }

  return stats;
}

module.exports = {
  checkRequest,
  checkRateLimit,
  checkContent,
  unbanUser,
  getStats,
  SPAM_CONFIG,
};
