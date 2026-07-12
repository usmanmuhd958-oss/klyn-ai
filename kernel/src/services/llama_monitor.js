const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LLAMA_MODEL = process.env.LLAMA_MODEL || '/data/data/com.termux/files/home/klyn-ai-os/models/deepseek-coder-6.7b.Q5_K_M.gguf';
const LLAMA_BIN = '/data/data/com.termux/files/home/klyn-ai-os/llama.cpp/main';
const LLAMA_THREADS = process.env.LLAMA_THREADS || '4';
const LLAMA_N_BATCH = process.env.LLAMA_N_BATCH || '128';
const LLAMA_MEMORY_LIMIT_MB = parseInt(process.env.LLAMA_MEMORY_LIMIT_MB || '2048');

let llamaProc = null;
let procMetrics = {
  startTime: null,
  invocations: 0,
  totalProcessingMs: 0,
  peakMemoryMB: 0,
  thermalThrottleCount: 0
};

function getThermalZoneTemp() {
  try {
    const tempFile = '/sys/class/thermal/thermal_zone0/temp';
    if (fs.existsSync(tempFile)) {
      const raw = fs.readFileSync(tempFile, 'utf8').trim();
      return parseInt(raw) / 1000;
    }
  } catch (err) {
    return null;
  }
}

function getProcessMemoryMB(pid) {
  try {
    const statusFile = `/proc/${pid}/status`;
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf8');
      const match = content.match(/VmRSS:\s+(\d+)\s+kB/);
      if (match) return parseInt(match[1]) / 1024;
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function startLlamaServer() {
  if (llamaProc && llamaProc.exitCode === null) {
    console.log('[LlamaMonitor] Server already running (PID ' + llamaProc.pid + ')');
    return;
  }

  try {
    console.log('[LlamaMonitor] Starting llama.cpp server...');
    llamaProc = spawn(LLAMA_BIN, [
      '-m', LLAMA_MODEL,
      '-t', LLAMA_THREADS,
      '--n_batch', LLAMA_N_BATCH,
      '--server',
      '--port', '8000'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    procMetrics.startTime = Date.now();

    llamaProc.stdout.on('data', (chunk) => {
      console.log('[LlamaServer stdout]', chunk.toString().slice(0, 200));
    });

    llamaProc.stderr.on('data', (chunk) => {
      console.error('[LlamaServer stderr]', chunk.toString().slice(0, 200));
    });

    llamaProc.on('close', (code) => {
      console.warn(`[LlamaMonitor] Server exited with code ${code}`);
      llamaProc = null;
    });

    console.log(`✅ Llama.cpp server started (PID ${llamaProc.pid})`);
  } catch (err) {
    console.error('[LlamaMonitor] Start error:', err);
    throw err;
  }
}

async function monitorHealth() {
  if (!llamaProc || llamaProc.exitCode !== null) {
    return { status: 'down', message: 'Process not running' };
  }

  const temp = getThermalZoneTemp();
  const memory = getProcessMemoryMB(llamaProc.pid);
  
  const health = {
    status: 'up',
    pid: llamaProc.pid,
    uptime: Date.now() - procMetrics.startTime,
    memory: memory,
    temperature: temp,
    metrics: { ...procMetrics }
  };

  if (memory && memory > procMetrics.peakMemoryMB) {
    procMetrics.peakMemoryMB = memory;
  }

  if (temp && temp > 85) {
    console.warn(`[LlamaMonitor] HIGH TEMPERATURE: ${temp}°C – throttling inference`);
    procMetrics.thermalThrottleCount++;
  }

  return health;
}

async function stopLlamaServer() {
  if (!llamaProc || llamaProc.exitCode !== null) {
    console.log('[LlamaMonitor] Server not running');
    return;
  }

  llamaProc.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  if (llamaProc.exitCode === null) {
    llamaProc.kill('SIGKILL');
  }

  console.log('[LlamaMonitor] Server stopped');
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'start') {
    startLlamaServer().catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else if (cmd === 'stop') {
    stopLlamaServer().catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else if (cmd === 'health') {
    monitorHealth().then(h => {
      console.log(JSON.stringify(h, null, 2));
    });
  } else {
    console.log('Usage: node llama_monitor.js [start|stop|health]');
  }
}

module.exports = { startLlamaServer, stopLlamaServer, monitorHealth };
