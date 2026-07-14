/**
 * Hybrid LLM Monitor – automatic fallback to local DeepSeek‑Coder
 * when any cloud model (GPT‑5.5, Opus, Gemini, DeepSeek R1) fails.
 * Runs continuously, integrates with the Cognitive Router.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = '/data/data/com.termux/files/home/klyn-ai-os';
const LOG  = path.join(ROOT, 'runtime', 'logs', 'hybrid_llm.log');
function log(msg) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); }

const { getLlamaMonitor } = require('./llama_monitor');
const llama = getLlamaMonitor();

class HybridLLMMonitor {
    constructor() {
        this.cloudStatus = {
            openai:    { healthy: true, lastCheck: null },
            anthropic: { healthy: true, lastCheck: null },
            gemini:    { healthy: true, lastCheck: null },
            deepseek:  { healthy: true, lastCheck: null },
        };
        this._startMonitoring();
        log('Hybrid LLM Monitor started');
    }

    _startMonitoring() {
        // Check cloud models every 60 seconds
        setInterval(() => this._checkCloudModels(), 60000);
        // Check local model every 30 seconds (handled by llama_monitor)
        setInterval(() => {
            llama._check();
        }, 30000);
    }

    async _checkCloudModels() {
        const providers = {
            openai:    { url: 'https://api.openai.com/v1/models', keyEnv: 'OPENAI_API_KEY' },
            anthropic: { url: 'https://api.anthropic.com/v1/messages', keyEnv: 'ANTHROPIC_API_KEY' },
            gemini:    { url: 'https://generativelanguage.googleapis.com/v1beta/models', keyEnv: 'GEMINI_API_KEY' },
            deepseek:  { url: 'https://api.deepseek.com/v1/models', keyEnv: 'DEEPSEEK_API_KEY' },
        };

        for (const [name, cfg] of Object.entries(providers)) {
            const apiKey = process.env[cfg.keyEnv];
            if (!apiKey) {
                this.cloudStatus[name].healthy = false;
                this.cloudStatus[name].lastCheck = Date.now();
                continue;
            }
            try {
                const response = await fetch(cfg.url, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    signal: AbortSignal.timeout(5000),
                });
                this.cloudStatus[name].healthy = response.ok;
            } catch (e) {
                this.cloudStatus[name].healthy = false;
            }
            this.cloudStatus[name].lastCheck = Date.now();
        }

        log(`Cloud status: ${JSON.stringify(this.cloudStatus)}`);
        log(`Local LLM: ${llama.isHealthy() ? 'healthy' : 'unhealthy'}`);
    }

    /**
     * Returns the best available model for a task.
     * Prefers cloud models, falls back to local if all cloud are unhealthy.
     */
    getBestModel() {
        const clouds = Object.entries(this.cloudStatus).filter(([,s]) => s.healthy);
        if (clouds.length > 0) {
            return clouds[0][0];  // first available cloud model
        }
        if (llama.isHealthy()) {
            return 'local';
        }
        return 'none';
    }
}

let instance = null;
function getHybridLLMMonitor() {
    if (!instance) instance = new HybridLLMMonitor();
    return instance;
}
setInterval(() => {}, 3600000);
module.exports = { getHybridLLMMonitor };
