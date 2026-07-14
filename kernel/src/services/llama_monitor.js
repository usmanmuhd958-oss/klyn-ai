'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = '/data/data/com.termux/files/home/klyn-ai-os';
const LOG = path.join(ROOT, 'runtime', 'logs', 'llama_monitor.log');
const LLAMA_BIN = path.join(ROOT, 'llama.cpp', 'build', 'bin', 'llama-cli');
const MODEL = path.join(ROOT, 'llama.cpp', 'models', 'deepseek-coder-6.7b-instruct.Q4_K_M.gguf');

function log(msg) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); }

class LlamaMonitor {
  constructor() {
    this.healthy = false;
    this.lastCheck = null;
    this.failCount = 0;
    this._check();
    setInterval(() => this._check(), 30000).unref();
    log('LLM Monitor started');
  }

  _check() {
    if (!fs.existsSync(LLAMA_BIN) || !fs.existsSync(MODEL)) {
      log('LLM binary/model missing – local inference unavailable');
      this.healthy = false;
      this.lastCheck = Date.now();
      return;
    }
    exec(`"${LLAMA_BIN}" -m "${MODEL}" -p "test" -n 1 2>&1`, { timeout: 15000 }, (err) => {
      this.lastCheck = Date.now();
      if (err) { this.failCount++; this.healthy = false; log(`Health check failed (${this.failCount}): ${err.message}`); }
      else { this.failCount = 0; this.healthy = true; log('Health check passed'); }
    });
  }

  isHealthy() { return this.healthy; }
  getStatus() { return { healthy: this.healthy, lastCheck: this.lastCheck, failCount: this.failCount }; }
}

let instance = null;
function getLlamaMonitor() { if (!instance) instance = new LlamaMonitor(); return instance; }
module.exports = { getLlamaMonitor, LlamaMonitor };
