'use strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';

const ROOT = process.env.KLYN_PROJECT_ROOT
  || (process.env.HOME ? path.join(process.env.HOME, 'klyn-ai-os') : path.resolve(import.meta.dirname, '..', '..', '..'));
const LOG = path.join(ROOT, 'runtime', 'logs', 'evolution.log');
function log(msg) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); }
class EvolutionEngine {
  [key: string]: any;
  constructor() { this.history = []; log('Evolution Engine started – ready for agent self‑mutation'); }
  async propose({ targetFile, patchContent, reason, requesterId }) {
    if (!targetFile || !patchContent) throw new Error('Missing fields');
    const evoId = `evo_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    log(`[${evoId}] Patch proposed by ${requesterId}: ${reason}`);
    try {
      const tf = `${targetFile}.${evoId}.tmp`;
      fs.writeFileSync(tf, patchContent);
      fs.renameSync(tf, targetFile);
      let committed = true;
      let commitError = null;
      try {
        // @ts-ignore
        await new Promise((r, x) => exec(`cd "${ROOT}" && git add -A && git commit -m "EVOLUTION: ${evoId} - ${reason}"`, { timeout: 10000 }, (e) => e ? x(e) : r()));
      } catch (e) {
        // The patch is already on disk, so the evolution stands, but an
        // uncommitted mutation is not reproducible and must be surfaced.
        committed = false;
        commitError = e.message;
        log(`[${evoId}] Patch applied but git commit failed: ${e.message}`);
      }
      this.history.push({ evoId, targetFile, reason, requesterId, ts: Date.now(), committed, commitError });
      log(`[${evoId}] Evolution successful${committed ? '' : ' (uncommitted)'}`);
      return { evolutionId: evoId, status: 'COMPLETED', committed, commitError };
    } catch (e) { log(`[${evoId}] Evolution failed: ${e.message}`); throw e; }
  }
  getHistory() { return this.history; }
}
let _engineInstance = null;
export function getEvolutionEngine() {
  if (!_engineInstance) _engineInstance = new EvolutionEngine();
  return _engineInstance;
}
