const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', '..', 'runtime', 'state.json');
// Try to load Supabase, but fall back to local JSON if anything fails
let supabase = null;
try {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(__dirname, '..', '..', 'config', 'supabase.env') });
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    }
}
catch (e) { }
function localSet(key, value) {
    let data = {};
    try {
        if (fs.existsSync(DATA_FILE))
            data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
    catch (e) { }
    data[key] = { value, ts: new Date().toISOString() };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmpFile = DATA_FILE + ".tmp." + Date.now();
    fs.writeFileSync(tmpFile, JSON.stringify(data));
    fs.renameSync(tmpFile, DATA_FILE);
}
function localGet(key) {
    try {
        if (!fs.existsSync(DATA_FILE))
            return null;
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return data[key]?.value ?? null;
    }
    catch (e) {
        return null;
    }
}
async function setState(key, value) {
    if (supabase) {
        const { error } = await supabase.from('kv_store').upsert({ key, value, updated_at: new Date() });
        if (error)
            throw error;
    }
    else {
        localSet(key, value);
    }
}
async function getState(key) {
    if (supabase) {
        const { data, error } = await supabase.from('kv_store').select('value').eq('key', key).single();
        if (error || !data)
            return null;
        return data.value;
    }
    else {
        return localGet(key);
    }
}
module.exports = { setState, getState };
export {};
