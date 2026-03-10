// src/utils/maintenanceAccess.js
const ALLOWED_USER_IDS = new Set([
  '1107669393049128961',
]);

const ALLOWED_ROLE_IDS = new Set([
  '1452341421854953472', // こみゅにてぃおーなー
  '1450760856554967040', // ふぁうんだー
  '1453278624525455532', // あどばいざー
  '1451915537033597108', // おふぃさー
  '1455797992220000318', // 運営
]);

function hasMaintenanceAccess(userId, member) {
  if (ALLOWED_USER_IDS.has(String(userId))) return true;

  const roleCache = member?.roles?.cache;
  if (roleCache && typeof roleCache.some === 'function') {
    return roleCache.some((role) => ALLOWED_ROLE_IDS.has(String(role.id)));
  }
  return false;
}

module.exports = {
  hasMaintenanceAccess,
  ALLOWED_USER_IDS,
  ALLOWED_ROLE_IDS,
};
