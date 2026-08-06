#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------
const errorFile = process.argv[2];
const errorStack = process.argv[3] || '';

if (!errorFile || !errorStack) {
  console.error('Usage: node bug_hunter.js <file> "<error stack>"');
  process.exit(1);
}

if (!fs.existsSync(errorFile)) {
  console.error(`File not found: ${errorFile}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. SAFE PARSING & BACKUP
// ---------------------------------------------------------------------------
const backupFile = errorFile + '.bak';
fs.copyFileSync(errorFile, backupFile);
console.log(`[BugHunter] Backup created → ${backupFile}`);

const originalCode = fs.readFileSync(errorFile, 'utf8');

// ---------------------------------------------------------------------------
// 2. CONSTRAINED LLM PATCHING (Ollama / Local AI)
// ---------------------------------------------------------------------------
async function getFixFromLLM(prompt) {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';

  const res = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!(res as any).ok) {
    throw new Error(`LLM API returned ${(res as any).status}: ${await (res as any).text()}`);
  }

  const data = await (res as any).json();
  const rawText = data?.response || '';

  if (!rawText || rawText.trim().length === 0) {
    throw new Error('LLM returned an empty response');
  }

  // Sanitise: remove code fences if present
  let cleaned = rawText.trim();
  const fenceRegex = /^```(?:javascript|js|ts|json|bash)?\s*\n([\s\S]*?)\n```$/;
  const match = cleaned.match(fenceRegex);
  if (match) cleaned = match[1];

  return cleaned;
}

async function attemptFix() {
  const prompt = `You are an expert debugging AI. The following JavaScript file has a runtime error. Return ONLY the corrected file content, with no extra text, explanations, or markdown code fences.

Error:
${errorStack}

Original code:
${originalCode}`;

  try {
    return await getFixFromLLM(prompt);
  } catch (err) {
    console.error(`[BugHunter] LLM call failed: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 3. POST‑PATCH VERIFICATION
// ---------------------------------------------------------------------------
(async () => {
  try {
    const patchedCode = await attemptFix();

    // Write the patch
    fs.writeFileSync(errorFile, patchedCode, 'utf8');
    console.log('[BugHunter] Patched code written to file.');

    // Syntax check
    execSync(`node --check "${errorFile}"`, { stdio: 'pipe', timeout: 10_000 });
    console.log('[BugHunter] Syntax check passed ✓');

    // Success – exit 0 so orchestrator can restart the app
    process.exit(0);

  } catch (err) {
    console.error(`[BugHunter] Patch failed: ${err.message}`);

    // Restore original backup
    fs.copyFileSync(backupFile, errorFile);
    console.log('[BugHunter] Original file restored from backup.');

    process.exit(1);
  }
})();


export {};
