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
const { validateClient } = require('./subscription_manager');
const { rateLimiter } = require('./rate_limiter');
const { bestEffortCall } = require('./llm_provider');
// In‑memory rate limiter: 100 requests per 60s window per client
const clientRateLimiter = rateLimiter({ windowMs: 60000, maxRequests: 100 });
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
    // 2. Apply rate limiter (returns an Express‑style middleware; we use it directly)
    // For simplicity we call the rate limiter function manually
    // In production, this would be middleware on the API endpoint.
    const rateLimitKey = `client:${clientId}`;
    const now = Date.now();
    if (!clientRateLimiter._clients)
        clientRateLimiter._clients = new Map();
    const timestamps = clientRateLimiter._clients.get(rateLimitKey) || [];
    const recent = timestamps.filter(t => now - t < 60000);
    if (recent.length >= 100) {
        throw new Error('Rate limit exceeded (100 requests/min)');
    }
    recent.push(now);
    clientRateLimiter._clients.set(rateLimitKey, recent);
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
        }
        else {
            // Fallback chain
            for (const model of modelNames) {
                try {
                    result = await bestEffortCall(prompt, model);
                    usedModel = model;
                    break;
                }
                catch (e) {
                    continue;
                }
            }
        }
        if (!result)
            throw new Error('All models failed');
    }
    catch (e) {
        // Absolute last resort: local offline template
        const { execSync } = require('child_process');
        result = execSync(`bash agents/src/local_intelligence.sh "${prompt}"`).toString();
        usedModel = 'local-offline';
    }
    // 4. Log usage (append to a simple JSON lines file)
    const fs = require('fs');
    const path = require('path');
    const usageLog = path.join(__dirname, '..', '..', 'runtime', 'logs', 'usage.jsonl');
    const logEntry = JSON.stringify({
        ts: new Date().toISOString(),
        clientId,
        model: usedModel,
        promptLen: prompt.length
    }) + '\n';
    fs.appendFileSync(usageLog, logEntry);
    return { result, model: usedModel };
}
module.exports = { arenaRequest };
export {};
