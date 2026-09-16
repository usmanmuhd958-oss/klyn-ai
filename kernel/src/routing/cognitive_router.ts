'use strict';
import fs from 'node:fs';
import path from 'node:path';

const LOG = process.env.KLYN_LOG_DIR
  ? path.join(process.env.KLYN_LOG_DIR, 'cognitive_router.log')
  : path.join(process.env.HOME || '', 'klyn-ai-os', 'runtime', 'logs', 'cognitive_router.log');
function log(msg) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); }
class CognitiveRouter {
  [key: string]: any;
  constructor() {
    this.tasks = [];
    this.agents = new Map([['coder',{s:0,f:0}],['planner',{s:0,f:0}],['reviewer',{s:0,f:0}]]);
    setInterval(() => this._route(), 2000);
    log('Cognitive Router started – ready to route tasks');
  }
  enqueue(task) { this.tasks.push(task); log(`Task queued: ${task.type}`); }
  _route() { if (this.tasks.length === 0) return; const t = this.tasks.shift(); const a = [...this.agents.keys()]; const best = a[Math.floor(Math.random() * a.length)]; log(`Task ${t.type} routed to ${best}`); }
}
let _routerInstance = null;
export function getCognitiveRouter() {
  if (!_routerInstance) _routerInstance = new CognitiveRouter();
  return _routerInstance;
}
