'use strict';
const fs = require('fs');
const path = require('path');
const LOG_DIR = path.join('/data/data/com.termux/files/home/klyn-ai-os', 'runtime', 'logs');

function createLogger(name) {
    return {
        info: (msg, meta) => {
            const line = `[INFO][${name}] ${msg} ${meta ? JSON.stringify(meta) : ''}`;
            fs.appendFileSync(path.join(LOG_DIR, `${name}.log`), line + '\n');
        },
        error: (msg, meta) => {
            const line = `[ERROR][${name}] ${msg} ${meta ? JSON.stringify(meta) : ''}`;
            fs.appendFileSync(path.join(LOG_DIR, `${name}.log`), line + '\n');
        },
        warn: (msg, meta) => {
            const line = `[WARN][${name}] ${msg} ${meta ? JSON.stringify(meta) : ''}`;
            fs.appendFileSync(path.join(LOG_DIR, `${name}.log`), line + '\n');
        },
        debug: () => {},
    };
}

function generateCorrelationId() {
    return `corr_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
}

module.exports = { createLogger, generateCorrelationId };
