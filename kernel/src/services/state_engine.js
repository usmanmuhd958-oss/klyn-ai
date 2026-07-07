const fs = require('fs');
const path = require('path');
let useSupabase = false;
let supabase;

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '..', 'config', 'supabase.env') });
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    useSupabase = true;
  }
} catch(e) {}

const runtimeDir = path.join(__dirname, '..', '..', 'runtime');
const localDbFile = path.join(runtimeDir, 'state.json');

function localSet(key, value) {
  let data = {};
  if (fs.existsSync(localDbFile)) {
    try { data = JSON.parse(fs.readFileSync(localDbFile, 'utf8')); } catch(e) {}
  }
  data[key] = { value, ts: new Date().toISOString() };
  fs.mkdirSync(path.dirname(localDbFile), { recursive: true });
  fs.writeFileSync(localDbFile, JSON.stringify(data));
}

function localGet(key) {
  if (!fs.existsSync(localDbFile)) return null;
  let data = {};
  try { data = JSON.parse(fs.readFileSync(localDbFile, 'utf8')); } catch(e) {}
  return data[key]?.value || null;
}

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

// CLI test
if (require.main === module) {
  const cmd = process.argv[2];
  (async () => {
    if (cmd === 'health') {
      await setState('health_check', { ts: new Date().toISOString() });
      const val = await getState('health_check');
      console.log(val ? 'healthy' : 'unhealthy');
      process.exit(val ? 0 : 1);
    }
  })();
}
module.exports = { setState, getState };
