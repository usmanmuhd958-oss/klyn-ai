const fs = require('fs');
const path = require('path');

const projectRoot = process.env.PROJECT_ROOT || process.cwd();
const runtimeDir = path.join(projectRoot, 'runtime');
const logsDir = path.join(runtimeDir, 'logs');

let passed = 0, failed = 0;

function check(label, condition) {
  if (condition) { console.log(`[PASS] ${label}`); passed++; }
  else { console.log(`[FAIL] ${label}`); failed++; }
}

// Create directories if missing
fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

check('Runtime directory', fs.existsSync(runtimeDir));
check('Logs directory', fs.existsSync(logsDir));

// Test API
const http = require('http');
http.get('http://localhost:3000/status', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    check('API running', res.statusCode === 200 && data.includes('healthy'));
    // Test state engine
    try {
      const state = require('./kernel/src/services/state_engine.js');
      state.setState('ci_test', { ok: true });
      const val = state.getState('ci_test');
      check('State engine', val && val.ok === true);
    } catch(e) { check('State engine', false); }
    console.log(`===========\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
}).on('error', () => {
  check('API running', false);
  try {
    const state = require('./kernel/src/services/state_engine.js');
    state.setState('ci_test', { ok: true });
    const val = state.getState('ci_test');
    check('State engine', val && val.ok === true);
  } catch(e) { check('State engine', false); }
  console.log(`===========\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
