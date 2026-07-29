'use strict';

let pino = null;
try {
  pino = require('pino');
} catch (_) {}

const logger = pino
  ? pino({
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
      level: process.env.LOG_LEVEL || 'info',
    })
  : {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

module.exports = logger;


export {};
