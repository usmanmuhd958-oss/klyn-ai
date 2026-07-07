const fs = require('fs');
const path = require('path');
const runtimeDir = path.join(__dirname, '..', '..', 'runtime');
const localDbFile = path.join(runtimeDir, 'state.db');

function localSet(key, value) {
  const data = fs.existsSync(localDbFile) ? JSON.parse(fs.readFileSync(localDbFile, 'utf8') || '{}') : {};
  data[key] = value;
  fs.writeFileSync(localDbFile, JSON.stringify(data));
}
function localGet(key) {
  if (!fs.existsSync(localDbFile)) return null;
  const data = JSON.parse(fs.readFileSync(localDbFile, 'utf8') || '{}');
  return data[key] || null;
}
async function setState(key, value) { localSet(key, value); }
async function getState(key) { return localGet(key); }

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'health') {
    setState('health_check', { ts: new Date().toISOString() });
    const val = getState('health_check');
    console.log(val && val.ts ? 'healthy' : 'unhealthy');
    process.exit(val ? 0 : 1);
  }
}
module.exports = { setState, getState };
