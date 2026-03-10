// src/db/sqlite.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function openDb(dbPath) {
    ensureDir(dbPath);
    return new sqlite3.Database(dbPath);
}

module.exports = { openDb };
