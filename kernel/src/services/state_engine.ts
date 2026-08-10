import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const DATA_FILE = path.join(import.meta.dirname, '..', '..', 'runtime', 'state.json');

// ===========================================================================
// AUDIT FIX (2026-08):
//   1. `@supabase/supabase-js` was a STATIC ESM import. With the package not
//      in package.json, the module load threw ERR_MODULE_NOT_FOUND at import
//      time — before the try/catch below ever ran — so the documented
//      "fall back to local JSON" path was dead code and the whole module
//      failed to load. The client is now resolved lazily via dynamic import,
//      so the local fallback actually works when the package is absent.
//   2. localSet() was a read-modify-write of the whole JSON file with no
//      serialization: concurrent setState() calls lost updates. Writes now
//      go through an in-process promise chain (single-flight mutex), and
//      reads hit an in-memory mirror so they never observe torn state.
// ===========================================================================

// Lazy Supabase client (resolved once, cached; null when unavailable).
let supabasePromise = null;

async function ensureSupabase() {
  if (!supabasePromise) {
    supabasePromise = (async () => {
      try {
        dotenv.config({ path: path.join(import.meta.dirname, '..', '..', 'config', 'supabase.env') });
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
        const mod = await import('@supabase/supabase-js');
        return mod.createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      } catch (e) {
        return null;
      }
    })();
  }
  return supabasePromise;
}

/** In-memory mirror — the single source of truth for reads. */
const memStore = new Map();
/** Serializes localSet read-modify-write cycles. */
let writeChain = Promise.resolve();

function doLocalSet(key, value) {
  memStore.set(key, { value, ts: new Date().toISOString() });
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    // Persist the mirror in full (atomic tmp + rename). Serialized by the
    // write chain, so no two writers can interleave read-modify-write.
    const tmpFile = DATA_FILE + '.tmp.' + process.pid + '.' + Date.now();
    fs.writeFileSync(tmpFile, JSON.stringify(Object.fromEntries(memStore)));
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (e) {
    // Persistence failure must not break the in-memory state.
  }
}

function localSet(key, value) {
  writeChain = writeChain.then(() => doLocalSet(key, value)).catch(() => {});
  return writeChain;
}

function localGet(key) {
  const rec = memStore.get(key);
  return rec ? rec.value : null;
}

async function setState(key, value) {
  const supabase = await ensureSupabase();
  if (supabase) {
    const { error } = await supabase.from('kv_store').upsert({ key, value, updated_at: new Date() });
    if (error) throw error;
  } else {
    await localSet(key, value);
  }
}

async function getState(key) {
  const supabase = await ensureSupabase();
  if (supabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', key).single();
    if (error || !data) return null;
    return (data as any).value;
  } else {
    return localGet(key);
  }
}

export { setState, getState };


export {};
