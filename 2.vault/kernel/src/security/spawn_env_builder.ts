'use strict';
const path = require('path');
function buildAgentEnvironment(agentId, token, options: any = {}) {
  const env = {
    PATH: '/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/bin/applets',
    HOME: '/data/data/com.termux/files/home',
    TERMUX_VERSION: process.env.TERMUX_VERSION || '0.118.0',
    KLYN_AGENT_ID: agentId,
    KLYN_IPC_TOKEN: token,
    KLYN_RUNTIME_DIR: '/data/data/com.termux/files/home/klyn-ai-os/.runtime',
    NODE_ENV: 'production'
  };
  if (options.customEnv) Object.assign(env, options.customEnv);
  return env;
}
function auditSpawnEnvironment(env) {
  const leaks = [];
  const sensitiveKeys = ['ANDROID_ID', 'GOOGLE_API_KEY', 'API_KEY', 'PASSWORD', 'SECRET'];
  for (const key of Object.keys(env)) {
    if (sensitiveKeys.some(s => key.toUpperCase().includes(s))) {
      leaks.push(key);
    }
  }
  return { secure: leaks.length === 0, leaks };
}
module.exports = { buildAgentEnvironment, auditSpawnEnvironment };


export {};
