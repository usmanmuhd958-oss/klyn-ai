import fs from 'node:fs';
import path from 'node:path';

const logDir = process.env.KLYN_LOG_DIR || path.join(import.meta.dirname, '..', '..', 'runtime', 'logs');

export function log(level: string, message: string, meta: Record<string, any> = {}) {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  const line = JSON.stringify(entry);
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'system.jsonl'), line + '\n');
  console.log(line);

  // If Supabase is configured, also ship there (best-effort, never throws).
  import('@supabase/supabase-js')
    .then(async ({ createClient }) => {
      try {
        const dotenv = await import('dotenv');
        dotenv.config({ path: path.join(import.meta.dirname, '..', '..', 'config', 'supabase.env') });
        if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
          const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
          await supabase.from('logs').insert({ level, message, meta });
        }
      } catch (_) { /* never throw from logging */ }
    })
    .catch(() => { /* @supabase/supabase-js not installed */ });
}
