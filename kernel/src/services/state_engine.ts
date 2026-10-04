import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const DATA_FILE = path.join(import.meta.dirname, '..', '..', 'runtime', 'state.json');

// Try to load Supabase, but fall back to local JSON if anything fails
let supabase = null;
try {
  dotenv.config({ path: path.join(import.meta.dirname, '..', '..', 'config', 'supabase.env') });
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  }
} catch(e) {
  // The fallback is intentional, but a broken Supabase config must be visible
  // — otherwise state silently stops being shared between processes.
  console.warn(`[StateEngine] Supabase init failed (${e.message}) — falling back to local JSON state at ${DATA_FILE}`);
}

function localSet(key, value) {
  let data = {};
  try {
    if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) {
    // Writing would drop every existing key; say so instead of losing it quietly.
    console.error(`[StateEngine] Unreadable state file ${DATA_FILE} (${e.message}) — existing keys will be overwritten`);
  }
  data[key] = { value, ts: new Date().toISOString() };
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmpFile = DATA_FILE + ".tmp." + Date.now();
    fs.writeFileSync(tmpFile, JSON.stringify(data));
    fs.renameSync(tmpFile, DATA_FILE);
}

function localGet(key) {
  try { if (!fs.existsSync(DATA_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return data[key]?.value ?? null;
  } catch(e) {
    console.error(`[StateEngine] Unreadable state file ${DATA_FILE} (${e.message}) — reporting key '${key}' as missing`);
    return null;
  }
}

async function setState(key, value) {
  if (supabase) {
    const { error } = await supabase.from('kv_store').upsert({ key, value, updated_at: new Date() });
    if (error) throw error;
  } else {
    localSet(key, value);
  }
}

async function getState(key) {
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', key).single();
    // PGRST116 = "no rows" — a genuine miss. Any other error is a backend
    // failure and must propagate instead of masquerading as a missing key.
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return (data as any).value;
  } else {
    return localGet(key);
  }
}

export { setState, getState };


export {};
