const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;

const AGENTS_DIR = path.join(__dirname, '..', '..', 'agents', 'src');

// Whitelist of allowed agents (resolved absolute paths)
let agentWhitelist = new Set();

async function buildWhitelist() {
  try {
    if (!fs.existsSync(AGENTS_DIR)) {
      console.warn('[AgentExecutor] agents/src/ does not exist');
      return;
    }
    const files = await fsPromises.readdir(AGENTS_DIR);
    for (const file of files) {
      if (file.endsWith('.sh')) {
        const abs = path.resolve(path.join(AGENTS_DIR, file));
        agentWhitelist.add(abs);
      }
    }
    console.log(`[AgentExecutor] Whitelist loaded: ${agentWhitelist.size} agents`);
  } catch (err) {
    console.error('[AgentExecutor] Whitelist build error:', err);
  }
}

function validateAgentName(agentName) {
  // Strict: alphanumeric, dash, underscore only
  if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
    throw new Error(`Invalid agent name: ${agentName}`);
  }
  const resolved = path.resolve(path.join(AGENTS_DIR, agentName + '.sh'));
  
  // Prevent directory traversal
  if (!resolved.startsWith(AGENTS_DIR)) {
    throw new Error(`Agent path escape detected: ${agentName}`);
  }
  
  if (!agentWhitelist.has(resolved)) {
    throw new Error(`Agent not whitelisted: ${agentName}`);
  }
  
  return resolved;
}

function validateTask(task) {
  // Truncate and ban shell metacharacters
  const sanitized = String(task).slice(0, 1000);
  if (/[`$(){}[];|&<>]/.test(sanitized)) {
    throw new Error('Task contains forbidden shell metacharacters');
  }
  return sanitized;
}

function getMemoryUsage() {
  try {
    const mem = process.memoryUsage();
    return {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024)
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function executeAgent(agentName, task, timeout = 30000) {
  try {
    // Validation phase
    const agentPath = validateAgentName(agentName);
    const cleanTask = validateTask(task);
    
    // Log execution (for audit)
    const startMem = getMemoryUsage();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Spawn with NO shell, pass task as argument array
      const proc = spawn('bash', [agentPath, cleanTask], {
        shell: false,
        timeout,
        maxBuffer: 10 * 1024 * 1024,  // 10MB
        stdio: ['ignore', 'pipe', 'pipe']
      });

      proc.stdout.on('data', (chunk) => { stdout += chunk; });
      proc.stderr.on('data', (chunk) => { stderr += chunk; });

      proc.on('close', (code) => {
        const endTime = Date.now();
        const endMem = getMemoryUsage();
        resolve({
          success: code === 0,
          stdout: stdout.slice(0, 100 * 1024),  // Truncate output
          stderr: stderr.slice(0, 50 * 1024),
          exitCode: code,
          duration: endTime - startTime,
          memoryDelta: {
            heapUsed: endMem.heapUsed - startMem.heapUsed,
            rss: endMem.rss - startMem.rss
          }
        });
      });

      proc.on('error', (err) => {
        reject(new Error(`Spawn failed: ${err.message}`));
      });

      // Timeout fallback
      setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill('SIGTERM');
          reject(new Error(`Agent execution timeout (${timeout}ms)`));
        }
      }, timeout + 1000);
    });
  } catch (err) {
    return {
      success: false,
      error: err.message,
      stdout: '',
      stderr: ''
    };
  }
}

// Initialize on module load
buildWhitelist().catch(err => console.error('[AgentExecutor] Init error:', err));

module.exports = { executeAgent, getMemoryUsage };
