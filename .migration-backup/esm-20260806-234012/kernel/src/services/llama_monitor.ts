'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const ROOT = process.env.KLYN_PROJECT_ROOT
  || (process.env.HOME ? path.join(process.env.HOME, 'klyn-ai-os') : path.resolve(import.meta.dirname, '..', '..', '..'));
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
let _monitorInstance = null;
export function getLlamaMonitor() {
  if (!_monitorInstance) _monitorInstance = new LlamaMonitor();
  return _monitorInstance;
}
