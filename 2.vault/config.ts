// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// =============================================================================
// KLYN AI OS – Centralized System Configuration (Node.js)
// =============================================================================
require('dotenv').config({ path: `${__dirname}/.env` });

const config = {
  gitlab: {
    token: process.env.GITLAB_ACCESS_TOKEN || '',
  },
  github: {
    token: process.env.GH_PERSONAL_TOKEN || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'klyn-fallback-dev-secret',
  },
  ai: {
    openai:   { key: process.env.OPENAI_API_KEY   || '' },
    deepseek: { key: process.env.DEEPSEEK_API_KEY  || '' },
    gemini:   { key: process.env.GEMINI_API_KEY    || '' },
    claude:   { key: process.env.CLAUDE_API_KEY    || '' },
    local:    { enabled: true },
  },
  database: {
    supabaseUrl: process.env.SUPABASE_URL || '',
  },
};

function validateCriticalConfig() {
  const missing = [];

  if (!config.jwt.secret || config.jwt.secret === 'klyn-fallback-dev-secret') {
    if (process.env.NODE_ENV !== 'development') missing.push('JWT_SECRET');
  }
  if (!config.gitlab.token && !config.github.token) {
    missing.push('GITLAB_ACCESS_TOKEN or GH_PERSONAL_TOKEN');
  }
  const hasCloudAI = Object.values(config.ai).some(
    // @ts-ignore
    (p) => typeof p.key === 'string' && p.key.length > 0
  );
  if (!hasCloudAI && !config.ai.local.enabled) {
    missing.push('at least one cloud AI key');
  }

  if (missing.length) {
    console.warn(`⚠️  Missing configuration: ${missing.join(', ')}. Some features may be disabled.`);
  } else {
    console.log('✅ All critical configuration loaded.');
  }
}

validateCriticalConfig();
module.exports = config;


export {};
