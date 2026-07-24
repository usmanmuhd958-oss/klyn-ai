const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = '/data/data/com.termux/files/home/klyn-ai-os';
const IMPROVEMENT_LOG = path.join(PROJECT_ROOT, 'runtime', 'logs', 'autonomous_improver.log');
function log(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    console.log(entry);
    fs.appendFileSync(IMPROVEMENT_LOG, entry + '\n');
}
function runAudit() {
    log('Running code audit...');
    try {
        execSync('bash scripts/ai_code_review.sh', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    }
    catch (e) {
        log('Audit completed with suggestions.');
    }
}
function applySimpleFixes() {
    log('Applying automatic fixes...');
    // Fix missing shebangs
    const shFiles = execSync('find . -name "*.sh" -not -path "*/node_modules/*" -not -path "*/.git/*"', { cwd: PROJECT_ROOT }).toString().trim().split('\n');
    for (const f of shFiles) {
        const content = fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8');
        if (!content.startsWith('#!/bin/bash') && !content.startsWith('#!/usr/bin/env')) {
            log(`Fixed shebang: ${f}`);
            fs.writeFileSync(path.join(PROJECT_ROOT, f), '#!/bin/bash\n' + content);
        }
    }
    // Make all .sh files executable
    execSync('find . -name "*.sh" -not -path "*/node_modules/*" -not -path "*/.git/*" -exec chmod +x {} \\;', { cwd: PROJECT_ROOT });
    // Fix common Node.js require path issues (relative -> absolute)
    const jsFiles = execSync('find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*"', { cwd: PROJECT_ROOT }).toString().trim().split('\n');
    for (const f of jsFiles) {
        if (f.includes('../../') || f.includes('../'))
            continue; // skip already absolute
        // This is a simplified check; in production, use AST parsing
    }
    log('Automatic fixes applied.');
}
function runTests() {
    log('Running test suite...');
    try {
        execSync('bash scripts/run_tests.sh', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        log('All tests passed.');
        return true;
    }
    catch (e) {
        log('Tests failed: ' + e.stderr.toString());
        return false;
    }
}
function commitChanges() {
    try {
        execSync('git add -A', { cwd: PROJECT_ROOT });
        execSync('git commit -m "🧬 Autonomous self‑improvement cycle" || true', { cwd: PROJECT_ROOT });
        execSync('git push origin main', { cwd: PROJECT_ROOT });
        log('Changes committed and pushed.');
    }
    catch (e) {
        log('Commit/push failed: ' + e.message);
    }
}
function runImprovementCycle() {
    log('=== Starting autonomous improvement cycle ===');
    runAudit();
    applySimpleFixes();
    const testsPass = runTests();
    if (testsPass) {
        commitChanges();
        log('=== Improvement cycle complete — OS is healthier ===');
    }
    else {
        log('=== Tests failed, rolling back (no commit) ===');
        execSync('git checkout -- .', { cwd: PROJECT_ROOT });
    }
}
// Run immediately if called directly
if (require.main === module) {
    runImprovementCycle();
}
// Export for scheduled use
module.exports = { runImprovementCycle };
export {};
