import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
'use strict';

/**
 * KLYN AI OS – Multi‑Model Arena Gateway
 *
 * Integrates the subscription manager, rate limiter, and LLM provider
 * to serve AI requests under a flat‑fee subscription.
 *
 * Flow:
 *   1. Validate subscription (clientId, requestedModel)
 *   2. Apply rate limiter (per‑client, per‑minute)
 *   3. Route to the best available model (cloud → local fallback)
 *   4. Log usage and return response
 */

import { validateClient } from './subscription_manager.js';
import { bestEffortCall } from './llm_provider.js';

// Per‑client sliding window: 100 requests per 60s (flat‑fee plan cap)
const rateWindow = new Map<string, number[]>();

/**
 * Handle an arena request.
 * @param {string} clientId
 * @param {string} prompt
 * @param {string} preferredModel – optional
 * @returns {Promise<{ result: string, model: string, usage: number }>}
 */
async function arenaRequest(clientId, prompt, preferredModel = null) {
  // 1. Validate subscription
  const validation = validateClient(clientId, preferredModel);
  if (!validation.valid) {
    throw new Error(`Subscription invalid: ${validation.reason}`);
  }

  // 2. Apply rate limiting (per client, sliding 60s window)
  const rateLimitKey = `client:${clientId}`;
  const now = Date.now();
  const recent = (rateWindow.get(rateLimitKey) || []).filter(t => now - t < 60000);
  if (recent.length >= 100) {
    throw new Error('Rate limit exceeded (100 requests/min)');
  }
  recent.push(now);
  rateWindow.set(rateLimitKey, recent);

  // 3. Route to the best model
  const modelNames = validation.plan === 'pro'
    ? ['gpt-5.5-pro', 'gemini-3.5-pro', 'deepseek-r1', 'local']
    : ['local'];

  let result;
  let usedModel;
  try {
    // Try preferred model first if provided and allowed
    const allowedSet = new Set(modelNames);
    if (preferredModel && allowedSet.has(preferredModel)) {
      result = await bestEffortCall(prompt, preferredModel);
      usedModel = preferredModel;
    } else {
      // Fallback chain
      for (const model of modelNames) {
        try {
          result = await bestEffortCall(prompt, model);
          usedModel = model;
          break;
        } catch (e) {
          continue;
        }
      }
    }
    if (!result) throw new Error('All models failed');
  } catch (e) {
    // Absolute last resort: local offline template
    import { execSync } from 'node:child_process';
    result = execSync(`bash agents/src/local_intelligence.sh "${prompt}"`).toString();
    usedModel = 'local-offline';
  }

  // 4. Log usage (append to a simple JSON lines file)
  import fs from 'node:fs';
  import path from 'node:path';
  const usageLog = path.join(import.meta.dirname, '..', '..', 'runtime', 'logs', 'usage.jsonl');
  const logEntry = JSON.stringify({
    ts: new Date().toISOString(),
    clientId,
    model: usedModel,
    promptLen: prompt.length
  }) + '\n';
  fs.appendFileSync(usageLog, logEntry);

  return { result, model: usedModel };
}

export { arenaRequest };


export {};
