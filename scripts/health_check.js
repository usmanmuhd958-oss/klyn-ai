const { execSync } = require('child_process');
const path = require('path');

const root = process.env.PROJECT_ROOT || path.join(__dirname, '..');
const checks = {};

// 1. Runtime directory
checks['Runtime directory'] = require('fs').existsSync(path.join(root, 'runtime'));

// 2. API running
try {
    execSync('pgrep -f "node api/server.js"', { stdio: 'ignore' });
    checks['API running'] = true;
} catch(e) {
    checks['API running'] = false;
}

// 3. State engine
try {
    const result = execSync(`node ${path.join(root, 'kernel/src/services/state_engine.js')} health`, { stdio: 'pipe', timeout: 5000 }).toString().trim();
    checks['State engine'] = result === 'healthy';
} catch(e) {
    checks['State engine'] = false;
}

let pass = 0, fail = 0;
for (const [name, ok] of Object.entries(checks)) {
    if (ok) {
        console.log(`[PASS] ${name}`);
        pass++;
    } else {
        console.log(`[FAIL] ${name}`);
        fail++;
    }
}
console.log('===========');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
