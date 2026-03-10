// src/services/bootDebug.js
function safeJson(obj) {
    try {
        return JSON.stringify(obj);
    } catch {
        return String(obj);
    }
}

function nowIso() {
    return new Date().toISOString();
}

function makeBootDebug(prefix = 'BOOT') {
    const enabled = String(process.env.BOOT_DEBUG || '1').trim() !== '0';

    function log(level, event, data = {}) {
        if (!enabled) return;
        const line = {
            ts: nowIso(),
            level,
            event: `${prefix}.${event}`,
            ...data,
        };
        // eslint-disable-next-line no-console
        console.log(safeJson(line));
    }

    return {
        info: (event, data) => log('info', event, data),
        warn: (event, data) => log('warn', event, data),
        error: (event, data) => log('error', event, data),
    };
}

module.exports = { makeBootDebug };
