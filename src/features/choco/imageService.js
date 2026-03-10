// src/features/choco/imageService.js
const fs = require('fs/promises');
const path = require('path');

const CHOCO_DIR = process.env.CHOCO_DIR || './images';
const CHOCO_STABLE_SEC = Number(process.env.CHOCO_STABLE_SEC || '5');
const CHOCO_MAX_MB = Number(process.env.CHOCO_MAX_MB || '20');
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function mb(bytes) {
  return bytes / 1024 / 1024;
}

/**
 * 対象ディレクトリから候補ファイルをリスト
 */
async function listCandidateFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const now = Date.now();

  const files = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;

    const ext = path.extname(ent.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;

    const fullPath = path.join(dirPath, ent.name);

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }

    // 生成直後のファイル(書き込み中・破損回避)
    const ageMs = now - stat.mtimeMs;
    if (ageMs < CHOCO_STABLE_SEC * 1000) continue;

    // サイズ上限
    if (mb(stat.size) > CHOCO_MAX_MB) continue;

    files.push({ 
      fullPath, 
      mtimeMs: stat.mtimeMs, 
      size: stat.size,
      fileName: ent.name 
    });
  }

  return files;
}

/**
 * ランダムに1つ選択
 */
function pickRandom(files) {
  const idx = Math.floor(Math.random() * files.length);
  return files[idx];
}

/**
 * 画像を1つ選んで返す
 */
async function pickChocoImage() {
  // ディレクトリ存在確認
  try {
    const st = await fs.stat(CHOCO_DIR);
    if (!st.isDirectory()) {
      return { ok: false, reason: 'CHOCO_DIR is not a directory.' };
    }
  } catch {
    return { ok: false, reason: 'CHOCO_DIR does not exist or cannot be accessed.' };
  }

  const files = await listCandidateFiles(CHOCO_DIR);
  if (files.length === 0) {
    return {
      ok: false,
      reason: 'No usable images found (empty, wrong extension, too new, or too large).',
    };
  }

  return { ok: true, file: pickRandom(files) };
}

/**
 * キーワード検出
 */
function normalizeText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function hasChocoKeyword(content) {
  const t = normalizeText(content);
  return t.includes('チョコ') || t.includes('ちょこ');
}

module.exports = {
  pickChocoImage,
  hasChocoKeyword,
};
