import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';

const require = createRequire(import.meta.url);
dotenv.config({ path: path.join(import.meta.dirname, '..', '..', 'config', 'supabase.env') });

let supabase;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    console.log('Supabase Realtime bus connected');
  }
} catch(e) {
  console.warn(`[RealtimeBus] Supabase init failed (${e.message}) — falling back to the local file bus`);
}

// Returns a promise so callers can await delivery; Supabase reports insert
// failures in the result object rather than throwing, so they are checked
// explicitly instead of being dropped by a bare .then().
function publish(channel, payload) {
  if (supabase) {
    return supabase.from('events').insert({ type: channel, data: payload }).then(({ error }) => {
      if (error) throw new Error(`Publish to '${channel}' failed: ${error.message}`);
    });
  }
  const p = path.join(import.meta.dirname, '..', '..', 'runtime', 'events', `${channel}.jsonl`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), data: payload }) + '\n');
  return Promise.resolve();
}

function subscribe(channel, handler) {
  if (supabase) {
    supabase
      .channel(channel)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `type=eq.${channel}` }, payload => handler(payload.new.data))
      .subscribe();
  } else {
    // Local file watcher fallback
    const p = path.join(import.meta.dirname, '..', '..', 'runtime', 'events', `${channel}.jsonl`);
    fs.watchFile(p, () => {
      // A throw inside a watcher callback cannot be caught by the caller and
      // would take the process down, so it is reported here.
      try {
        const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
        const last = JSON.parse(lines[lines.length-1]);
        handler(last.data);
      } catch (err) {
        console.error(`[RealtimeBus] Failed to dispatch event from ${p}: ${err.message}`);
      }
    });
  }
}

export { publish, subscribe };


export {};
