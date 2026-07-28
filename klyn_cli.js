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
      console.log('Starting Klyn AI OS v11.0 Matrix Swarm Engine...');
      try { execSync('fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"'); } catch (e) {}
      const logFd = fs.openSync(path.join(workDir, 'klyn_server.log'), 'a');
      const server = spawn('node', [path.join(workDir, 'klyn_server.js')], { 
        cwd: workDir, detached: true, stdio: ['ignore', logFd, logFd] 
      });
      server.unref();
      setTimeout(() => console.log('Klyn AI OS v11.0 Running on http://localhost:7860'), 1000);
      break;

    case 'apex':
      const promptText = args.slice(1).join(' ') || 'Autonomous Microservice Engine';
      console.log(`[KLYN V11.0 APEX] Executing Matrix Pipeline: "${promptText}"...`);
      try {
        const res = await fetchJSON('/v1/apex', 'POST', { prompt: promptText, file: 'apex_core_module.js' });
        console.log('\n=================== APEX PIPELINE RESULT ===================');
        console.log(JSON.stringify(res, null, 2));
        console.log('===========================================================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'refactor':
      const targetFile = args[1] || 'apex_core_module.js';
      console.log(`[KLYN V11.0 MATRIX] Running Refactor Pass on "${targetFile}"...`);
      try {
        const res = await fetchJSON('/v1/refactor', 'POST', { targetFile });
        console.log('\n=================== REFACTOR RESULT ===================');
        console.log(JSON.stringify(res, null, 2));
        console.log('======================================================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'memory':
      console.log('[KLYN V11.0 MEMORY] Telemetry Readout...');
      try {
        const res = await fetchJSON('/v1/memory', 'GET');
        console.log('\n=================== MEMORY TELEMETRY ===================');
        console.log(JSON.stringify(res, null, 2));
        console.log('========================================================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'benchmark':
      console.log('[BENCHMARK] Calculating Speed Differential Against Cloud AIs...');
      try {
        const res = await fetchJSON('/v1/benchmark', 'GET');
        console.log('\n=================== LATENCY BENCHMARK ===================');
        console.log(JSON.stringify(res, null, 2));
        console.log('========================================================\n');
      } catch (err) {
        console.log('Server offline. Run `klyn start` first.');
      }
      break;

    case 'status':
      try {
        const data = await fetchJSON('/v1/telemetry');
        console.log('\n=== KLYN V11.0 TELEMETRY ===');
        console.log(JSON.stringify(data, null, 2));
        console.log('============================\n');
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
      console.log('Usage: klyn <start|apex|refactor|memory|benchmark|status|stop>');
  }
}

main();
