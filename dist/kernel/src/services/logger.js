const fs = require('fs');
const path = require('path');
const logDir = path.join(__dirname, '..', '..', 'runtime', 'logs');
function log(level, message, meta = {}) {
    const entry = { ts: new Date().toISOString(), level, message, ...meta };
    const line = JSON.stringify(entry);
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'system.jsonl'), line + '\n');
    console.log(line);
    // If Supabase is configured, also ship there
    try {
        const { createClient } = require('@supabase/supabase-js');
        const dotenv = require('dotenv');
        dotenv.config({ path: path.join(__dirname, '..', '..', 'config', 'supabase.env') });
        if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
            const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
            supabase.from('logs').insert({ level, message, meta }).then();
        }
    }
    catch (e) { }
}
module.exports = { log };
export {};
