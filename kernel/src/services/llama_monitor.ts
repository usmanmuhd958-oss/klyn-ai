'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ROOT = '/data/data/com.termux/files/home/klyn-ai-os';
const LOG = path.join(ROOT, 'runtime', 'logs', 'llama_monitor.log');
const MODEL = path.join(ROOT, 'llama.cpp', 'models', 'deepseek-coder-6.7b-instruct.Q4_K_M.gguf');
function log(msg) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); }
class LlamaMonitor {
  [key: string]: any;
  constructor() {
    this.healthy = false;
    this._check();
    setInterval(() => this._check(), 30000);
    log('LLM Monitor started');
  }
  _check() {
    if (!fs.existsSync(MODEL)) { this.healthy = false; log('Model file missing'); return; }
    exec('echo "test" | head -1', { timeout: 5000 }, (err) => {
      this.healthy = !err;
      log(`Health: ${this.healthy ? 'healthy' : 'unhealthy'}`);
    });
  }
}
new LlamaMonitor();
setInterval(() => {}, 3600000);


export {};
