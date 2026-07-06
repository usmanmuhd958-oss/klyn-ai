const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
let useSupabase = false;
let supabase;

// Try loading Supabase config
try {
  const envFile = path.join(__dirname, '..', '..', 'config', 'supabase.env');
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      useSupabase = true;
    }
  }
} catch (e) {}

// Local SQLite fallback (for offline/backup)
const Database = require('better-sqlite3') || null; // fallback to simple file ops if not installed
// Simpler fallback using file system directly for critical cases
const runtimeDir = path.join(__dirname, '..', '..', 'runtime');
const localDbFile = path.join(runtimeDir, 'state.db');

function localSet(key, value) {
  const db = new (require('better-sqlite3'))(localDbFile);
  db.prepare('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)').run();
  db.prepare('INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), new Date().toISOString());
  db.close();
}
function localGet(key) {
  if (!fs.existsSync(localDbFile)) return null;
  const db = new (require('better-sqlite3'))(localDbFile);
  const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
  db.close();
  return row ? JSON.parse(row.value) : null;
}

// Main functions
async function setState(key, value) {
  if (useSupabase) {
    const { error } = await supabase.from('kv_store').upsert({ key, value, updated_at: new Date() });
    if (error) throw error;
  } else {
    localSet(key, value);
  }
}
async function getState(key) {
  if (useSupabase) {
    const { data, error } = await supabase.from('kv_store').select('value').eq('key', key).single();
    if (error || !data) return null;
    return data.value;
  } else {
    return localGet(key);
  }
}
async function publishEvent(type, data) {
  if (useSupabase) {
    await supabase.from('events').insert({ type, data });
  } else {
    const eventsFile = path.join(runtimeDir, 'events', 'events.jsonl');
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.appendFileSync(eventsFile, JSON.stringify({ type, data, ts: new Date().toISOString() }) + '\n');
  }
}

// CLI test
if (require.main === module) {
  const cmd = process.argv[2];
  (async () => {
    if (cmd === 'health') {
      await setState('health_check', { ts: new Date().toISOString() });
      const val = await getState('health_check');
      if (val && val.ts) console.log('healthy');
      else console.log('unhealthy');
      process.exit(val ? 0 : 1);
    } else if (cmd === 'get') {
      console.log(JSON.stringify(await getState(process.argv[3])));
    } else if (cmd === 'set') {
      await setState(process.argv[3], JSON.parse(process.argv[4]));
      console.log('ok');
    }
  })().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { setState, getState, publishEvent };
