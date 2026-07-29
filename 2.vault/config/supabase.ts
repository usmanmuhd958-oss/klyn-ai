// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
'use strict';

const logger = require('./logger');

let supabase = null;

function validateEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    logger.warn('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY must be set. Running without database.');
    return null;
  }
  return { url, key };
}

function getSupabase() {
  if (supabase) return supabase;

  const env = validateEnv();
  if (!env) return null;

  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(env.url, env.key);
    logger.info('Supabase client initialised');
    return supabase;
  } catch (err) {
    logger.error({ err }, 'Failed to initialise Supabase client');
    return null;
  }
}

module.exports = { getSupabase, validateEnv };


export {};
