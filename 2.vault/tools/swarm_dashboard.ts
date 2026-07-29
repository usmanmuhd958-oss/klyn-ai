// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import * as process from 'node:process';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  home: '\x1b[H\x1b[J',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
};

interface AgentState {
  name: string;
  role: string;
  status: 'IDLE' | 'BIDDING' | 'EXECUTING' | 'TELEPATHY_SYNC' | 'SELF_HEALING';
  task: string;
  cpuUsage: number;
}

const agents: AgentState[] = [
  { name: 'Architect', role: 'System Topology', status: 'IDLE', task: 'Optimizing routing', cpuUsage: 2 },
  { name: 'CoderAgent', role: 'AST Code Gen', status: 'EXECUTING', task: 'Compiling WASM kernel', cpuUsage: 64 },
  { name: 'Reviewer', role: 'Static Analysis', status: 'BIDDING', task: 'Evaluating AST checks', cpuUsage: 18 },
  { name: 'Auditor', role: 'Security Check', status: 'TELEPATHY_SYNC', task: 'Syncing Embeddings', cpuUsage: 35 },
  { name: 'BugHunter', role: 'Autonomous Healing', status: 'SELF_HEALING', task: 'Fixing stack traces', cpuUsage: 16 },
];

const ipcLogs: string[] = [
  "[SYSTEM] Swarm Mesh active on Termux.",
  "[TELEPATHY] IPC Mailbox opened on shared vector bus.",
];

function updateSimulation() {
  const randomAgent = agents[Math.floor(Math.random() * agents.length)];
  const statuses: AgentState['status'][] = ['IDLE', 'BIDDING', 'EXECUTING', 'TELEPATHY_SYNC', 'SELF_HEALING'];
  randomAgent.status = statuses[Math.floor(Math.random() * statuses.length)];
  randomAgent.cpuUsage = Math.floor(Math.random() * 80) + 5;

  if (Math.random() > 0.4) {
    const timestamp = new Date().toISOString().substring(11, 19);
    ipcLogs.unshift(`[${timestamp}] [${randomAgent.name} ➔ MESH]: ${randomAgent.status}`);
    if (ipcLogs.length > 5) ipcLogs.pop();
  }
}

function renderUI() {
  let out = C.home;
  const memoryMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

  out += `${C.cyan}====================================================${C.reset}\n`;
  out += `${C.bold}${C.magenta}🚀 KLYN AI OS — LIVE SWARM TELEMETRY DASHBOARD${C.reset}\n`;
  out += `${C.cyan}====================================================${C.reset}\n\n`;

  out += ` Nodes: ${C.green}5 Agents${C.reset} | Latency: ${C.cyan}12ms${C.reset} | RAM: ${C.yellow}${memoryMB} MB${C.reset}\n`;
  out += ` Mode : ${C.bold}100% Autonomous Decentralized Swarm${C.reset}\n\n`;

  out += `${C.bold}${C.yellow}[AGENT STATUS]${C.reset}\n`;
  out += `${C.dim}----------------------------------------------------${C.reset}\n`;
  out += `${C.bold}AGENT          STATUS          CPU   CURRENT TASK${C.reset}\n`;
  out += `${C.dim}----------------------------------------------------${C.reset}\n`;

  for (const a of agents) {
    let statusColor = C.green;
    if (a.status === 'BIDDING') statusColor = C.yellow;
    if (a.status === 'EXECUTING') statusColor = C.cyan;
    if (a.status === 'SELF_HEALING') statusColor = C.red;
    if (a.status === 'TELEPATHY_SYNC') statusColor = C.magenta;

    const nameStr = a.name.padEnd(14, ' ');
    const statusStr = (statusColor + a.status + C.reset).padEnd(23, ' ');
    const cpuStr = `${a.cpuUsage}%`.padEnd(5, ' ');
    const taskStr = a.task.length > 15 ? a.task.substring(0, 12) + '...' : a.task;

    out += `${C.bold}${nameStr}${C.reset} ${statusStr} ${cpuStr} ${C.dim}${taskStr}${C.reset}\n`;
  }

  out += `${C.dim}----------------------------------------------------${C.reset}\n\n`;
  out += `${C.bold}${C.cyan}[IPC TELEPATHY STREAM]${C.reset}\n`;
  out += `${C.dim}----------------------------------------------------${C.reset}\n`;
  for (const log of ipcLogs) {
    out += `${C.dim}${log}${C.reset}\n`;
  }
  out += `\n${C.dim}[Ctrl+C to exit]${C.reset}`;

  process.stdout.write(out);
}

process.stdout.write(C.hideCursor);
const interval = setInterval(() => {
  updateSimulation();
  renderUI();
}, 800);

process.on('SIGINT', () => {
  clearInterval(interval);
  process.stdout.write(C.showCursor + '\n\n' + C.green + '[INFO] Dashboard Closed.' + C.reset + '\n');
  process.exit(0);
});
