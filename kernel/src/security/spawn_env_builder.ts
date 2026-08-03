'use strict';
import path from 'node:path';
import os from 'node:os';

const SYS_PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
const HOME = process.env.HOME || os.homedir();

export function buildAgentEnvironment(agentId, token, options: any = {}) {
  const env = {
    PATH: SYS_PATH,
    HOME,
    TERMUX_VERSION: process.env.TERMUX_VERSION || '',
    KLYN_AGENT_ID: agentId,
    KLYN_IPC_TOKEN: token,
    KLYN_RUNTIME_DIR: process.env.KLYN_RUNTIME_DIR || path.join(HOME, '.klyn'),
    NODE_ENV: 'production'
  };
  if (options.customEnv) Object.assign(env, options.customEnv);
  return env;
}

export function auditSpawnEnvironment(env) {
  const leaks = [];
  const sensitiveKeys = ['ANDROID_ID', 'GOOGLE_API_KEY', 'API_KEY', 'PASSWORD', 'SECRET'];
  for (const key of Object.keys(env)) {
    if (sensitiveKeys.some(s => key.toUpperCase().includes(s))) {
      leaks.push(key);
    }
  }
  return { secure: leaks.length === 0, leaks };
}
