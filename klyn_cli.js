#!/usr/bin/env node

import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const workDir = process.cwd();
const args = process.argv.slice(2);
const command = args[0] || 'status';

function fetchJSON(urlPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7860,
      path: urlPath,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  switch (command) {
    case 'start':
      console.log('Starting Klyn AI OS v9.0 Swarm Engine...');
      try { execSync('fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"'); } catch (e) {}
      const logFd = fs.openSync(path.join(workDir, 'klyn_server.log'), 'a');
      const server = spawn('node', [path.join(workDir, 'klyn_server.js')], { 
        cwd: workDir, detached: true, stdio: ['ignore', logFd, logFd] 
      });
      server.unref();
      setTimeout(() => console.log('Klyn AI OS v9.0 Running on http://localhost:7860'), 1000);
      break;

    case 'heal':
      const targetFile = args[1] || 'ast_woven_module.js';
      console.log(`[KLYN V9.0 HEAL] Triggering Self-Healing Loop on: "${targetFile}"...`);
      try {
        const res = await fetchJSON('/v1/heal', 'POST', { file: targetFile });
        console.log('\n=================== SELF-HEALING RESULT ===================');
        console.log(JSON.stringify(res, null, 2));
        console.log('==========================================================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'swarm':
      const promptText = args.slice(1).join(' ') || 'Distributed Autonomous Swarm Engine';
      console.log(`[KLYN V9.0 SWARM] Synthesizing 5-Node Swarm: "${promptText}"...`);
      try {
        const res = await fetchJSON('/v1/swarm', 'POST', { prompt: promptText, file: 'swarm_cluster_module.js' });
        console.log('\n=================== SWARM CLUSTER RESULT ===================');
        console.log(JSON.stringify(res, null, 2));
        console.log('===========================================================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'search':
      const queryText = args.slice(1).join(' ') || 'swarm';
      console.log(`[MICRO-VECTOR SEARCH] Searching RAM for: "${queryText}"...`);
      try {
        const res = await fetchJSON('/v1/search', 'POST', { query: queryText });
        console.log('\n=================== VECTOR SEARCH RESULTS ===================');
        console.log(JSON.stringify(res, null, 2));
        console.log('==========================================================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'status':
      try {
        const data = await fetchJSON('/v1/telemetry');
        console.log('\n=== KLYN V9.0 TELEMETRY ===');
        console.log(JSON.stringify(data, null, 2));
        console.log('===========================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'stop':
      try {
        execSync('fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"');
        console.log('Klyn services stopped.');
      } catch (e) {}
      break;

    default:
      console.log('Usage: klyn <start|heal|swarm|search|status|stop>');
  }
}

main();
