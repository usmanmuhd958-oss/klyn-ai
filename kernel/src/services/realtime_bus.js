const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '..', 'config', 'supabase.env') });

let supabase;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    console.log('Supabase Realtime bus connected');
  }
} catch(e) {}

function publish(channel, payload) {
  if (supabase) {
    supabase.from('events').insert({ type: channel, data: payload }).then();
  } else {
    const fs = require('fs');
    const p = path.join(__dirname, '..', '..', 'runtime', 'events', `${channel}.jsonl`);
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), data: payload }) + '\n');
  }
}

function subscribe(channel, handler) {
  if (supabase) {
    supabase
      .channel(channel)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `type=eq.${channel}` }, payload => handler(payload.new.data))
      .subscribe();
  } else {
    // Local file watcher fallback
    const fs = require('fs');
    const p = path.join(__dirname, '..', '..', 'runtime', 'events', `${channel}.jsonl`);
    fs.watchFile(p, () => {
      const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
      const last = JSON.parse(lines[lines.length-1]);
      handler(last.data);
    });
  }
}

module.exports = { publish, subscribe };
