// ============================================================
// KLYN AI OS — Real-Time Dashboard Server v1.0.0
//
// Serves a live web dashboard at http://127.0.0.1:9001
//
// Features:
//   - Server-Sent Events (SSE) stream — no WebSocket needed
//   - Live agent status, metrics, workflow state
//   - Zero external JS runtime dependencies (vanilla HTML/JS)
//   - Single-file server — no build step
//   - Auth-gated (KLYN_API_TOKEN) except for /health
// ============================================================

'use strict';

import http from 'node:http';
import crypto from 'node:crypto';

// ─── DASHBOARD HTML ──────────────────────────────────────────
function buildDashboardHTML(apiToken) {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>KLYN AI OS — Dashboard</title>
  <style>
    :root {
      --bg:      #0d1117;
      --surface: #161b22;
      --border:  #30363d;
      --text:    #c9d1d9;
      --muted:   #8b949e;
      --green:   #3fb950;
      --yellow:  #d29922;
      --red:     #f85149;
      --blue:    #58a6ff;
      --purple:  #bc8cff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      color: var(--blue);
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 1px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-green  { background: #1a3a1a; color: var(--green);  }
    .badge-red    { background: #3a1a1a; color: var(--red);    }
    .badge-yellow { background: #3a2a0a; color: var(--yellow); }
    .badge-blue   { background: #0a1a3a; color: var(--blue);   }

    main { padding: 20px 24px; display: grid; gap: 16px; }

    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }

    @media (max-width: 900px) {
      .grid-2, .grid-4 { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card-title {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: var(--blue);
    }
    .stat-label { color: var(--muted); font-size: 11px; margin-top: 2px; }

    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 8px;
      border-bottom: 1px solid #1c2128;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #1c2128; }

    .status-dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }
    .dot-green  { background: var(--green);  box-shadow: 0 0 6px var(--green); }
    .dot-yellow { background: var(--yellow); }
    .dot-red    { background: var(--red);    box-shadow: 0 0 6px var(--red); }
    .dot-grey   { background: var(--muted);  }

    .log-area {
      background: #010409;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      height: 220px;
      overflow-y: auto;
      font-size: 11px;
      line-height: 1.8;
    }
    .log-line { white-space: pre-wrap; word-break: break-all; }
    .log-INFO  { color: var(--text); }
    .log-WARN  { color: var(--yellow); }
    .log-ERROR { color: var(--red); }
    .log-FATAL { color: var(--red); font-weight: bold; }
    .log-DEBUG { color: var(--muted); }
    .log-AUDIT { color: var(--purple); }

    .connection-status {
      display: flex; align-items: center; gap: 6px;
      font-size: 11px; color: var(--muted);
    }

    #uptime-display { font-variant-numeric: tabular-nums; }

    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 6px;
    }
    .progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .fill-green  { background: var(--green); }
    .fill-yellow { background: var(--yellow); }
    .fill-red    { background: var(--red); }

    button.action-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 3px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
      transition: border-color 0.2s;
    }
    button.action-btn:hover { border-color: var(--blue); color: var(--blue); }
  </style>
</head>
<body>

<header>
  <div class="logo">⚡ KLYN AI OS</div>
  <div style="display:flex;gap:16px;align-items:center">
    <span id="uptime-display" style="color:var(--muted)">uptime: --</span>
    <div class="connection-status">
      <span class="status-dot dot-grey" id="conn-dot"></span>
      <span id="conn-label">connecting...</span>
    </div>
  </div>
</header>

<main>

  <!-- KPI Row -->
  <div class="grid-4">
    <div class="card">
      <div class="card-title">Kernel Status</div>
      <div class="stat-value" id="kernel-status">—</div>
      <div class="stat-label">boot phase</div>
    </div>
    <div class="card">
      <div class="card-title">Agents Running</div>
      <div class="stat-value" id="agents-running">—</div>
      <div class="stat-label">of <span id="agents-total">—</span> registered</div>
    </div>
    <div class="card">
      <div class="card-title">Heap Usage</div>
      <div class="stat-value" id="heap-used">—</div>
      <div class="stat-label">MB used</div>
      <div class="progress-bar">
        <div class="progress-fill fill-green" id="heap-bar" style="width:0%"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">System Load</div>
      <div class="stat-value" id="sys-load">—</div>
      <div class="stat-label">1-min avg</div>
    </div>
  </div>

  <!-- Agent Table + Mailbox Table -->
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Agent Processes</div>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>State</th>
            <th>Restarts</th>
            <th>Uptime</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="agent-table-body">
          <tr><td colspan="5" style="color:var(--muted)">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-title">IPC Mailboxes</div>
      <table>
        <thead>
          <tr>
            <th>Mailbox</th>
            <th>Depth</th>
            <th>DLQ</th>
            <th>Delivered</th>
          </tr>
        </thead>
        <tbody id="mailbox-table-body">
          <tr><td colspan="4" style="color:var(--muted)">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Circuit Breakers -->
  <div class="card">
    <div class="card-title">Circuit Breakers</div>
    <div id="circuit-breakers" style="color:var(--muted);font-size:12px">
      No circuit breakers active.
    </div>
  </div>

  <!-- Live Log Stream -->
  <div class="card">
    <div class="card-title" style="display:flex;justify-content:space-between">
      <span>Live Event Stream</span>
      <button class="action-btn" onclick="clearLog()">Clear</button>
    </div>
    <div class="log-area" id="log-area"></div>
  </div>

</main>

<script>
  // ── CONFIG ────────────────────────────────────────────────
  const API_TOKEN = '${apiToken || ''}';
  const API_BASE  = 'http://127.0.0.1:9000';
  const SSE_URL   = '/api/events';

  // ── STATE ─────────────────────────────────────────────────
  let bootTime   = null;
  let uptimeTimer = null;

  // ── UTILITIES ─────────────────────────────────────────────
  function fmtBytes(b) {
    if (b == null) return '—';
    return (b / 1024 / 1024).toFixed(1);
  }

  function fmtMs(ms) {
    if (ms == null || ms === 0) return '—';
    if (ms < 1000)   return ms + 'ms';
    if (ms < 60000)  return (ms / 1000).toFixed(1) + 's';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m + 'm ' + s + 's';
  }

  function fmtUptime(ms) {
    if (!ms) return '0s';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return [h && h + 'h', m && m + 'm', s + 's'].filter(Boolean).join(' ');
  }

  function stateDot(state) {
    const map = {
      RUNNING:    'green',
      STARTING:   'yellow',
      RESTARTING: 'yellow',
      CRASHED:    'red',
      FAILED:     'red',
      STOPPED:    'grey',
      PENDING:    'grey',
    };
    const color = map[state] || 'grey';
    return '<span class="status-dot dot-' + color + '"></span>';
  }

  // ── LOG STREAM ────────────────────────────────────────────
  const logArea    = document.getElementById('log-area');
  const MAX_LINES  = 200;
  let logLineCount = 0;

  function appendLog(level, message) {
    const line = document.createElement('div');
    const ts   = new Date().toISOString().slice(11, 19);
    line.className = 'log-line log-' + (level || 'INFO');
    line.textContent = '[' + ts + '] [' + (level || 'INFO') + '] ' + message;
    logArea.appendChild(line);
    logLineCount++;
    if (logLineCount > MAX_LINES) {
      logArea.removeChild(logArea.firstChild);
      logLineCount--;
    }
    logArea.scrollTop = logArea.scrollHeight;
  }

  function clearLog() {
    logArea.innerHTML = '';
    logLineCount = 0;
  }

  // ── STATUS FETCH ──────────────────────────────────────────
  async function fetchStatus() {
    try {
      const headers = API_TOKEN ? { Authorization: 'Bearer ' + API_TOKEN } : {};
      const res  = await fetch(API_BASE + '/status', { headers });
      if (!(res as any).ok) return;
      const data = await (res as any).json();
      renderStatus(data);
    } catch (err) {
      appendLog('ERROR', 'Status fetch failed: ' + err.message);
    }
  }

  function renderStatus(data) {
    // ── Kernel KPIs
    const kernel = (data as any).kernel || {};
    document.getElementById('kernel-status').textContent =
      kernel.ready ? 'READY' : (kernel.bootPhase || '—');

    if (kernel.uptime && !bootTime) {
      bootTime = Date.now() - kernel.uptime;
      startUptimeTicker();
    }

    // ── Agents
    const processes = (data as any).processes || {};
    const agentIds  = Object.keys(processes);
    let running = 0;

    const agentRows = agentIds.map((id) => {
      const p = processes[id];
      if (p.state === 'RUNNING') running++;
      return '<tr>' +
        '<td><strong>' + id + '</strong></td>' +
        '<td>' + stateDot(p.state) + p.state + '</td>' +
        '<td style="text-align:center">' + (p.restartCount || 0) + '</td>' +
        '<td>' + fmtMs(p.uptime) + '</td>' +
        '<td>' +
          '<button class="action-btn" onclick="agentAction(\'' + id + '\',\'restart\')">↺</button> ' +
          '<button class="action-btn" onclick="agentAction(\'' + id + '\',\'stop\')">■</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    document.getElementById('agent-table-body').innerHTML =
      agentRows || '<tr><td colspan="5" style="color:var(--muted)">No agents</td></tr>';
    document.getElementById('agents-running').textContent = running;
    document.getElementById('agents-total').textContent   = agentIds.length;

    // ── Mailboxes
    const mailboxes = (data as any).mailboxes || {};
    const mbRows = Object.entries(mailboxes).map(([name, mb]) => {
      const depth   = mb.queueDepth || 0;
      const dlq     = mb.dlqDepth   || 0;
      const delivered = (mb.stats && mb.(stats as any).delivered) || 0;
      const depthColor = depth > 100 ? 'var(--red)' : depth > 20 ? 'var(--yellow)' : 'inherit';
      return '<tr>' +
        '<td>' + name + '</td>' +
        '<td style="color:' + depthColor + '">' + depth + '</td>' +
        '<td style="color:' + (dlq > 10 ? 'var(--yellow)' : 'inherit') + '">' + dlq + '</td>' +
        '<td style="color:var(--muted)">' + delivered + '</td>' +
      '</tr>';
    }).join('');

    document.getElementById('mailbox-table-body').innerHTML =
      mbRows || '<tr><td colspan="4" style="color:var(--muted)">No mailboxes</td></tr>';

    // ── Memory
    const mem = (data as any).metrics && (data as any).metrics.memory;
    if (mem) {
      const usedMb  = (mem.current / 1024 / 1024).toFixed(1);
      const peakMb  = (mem.peak   / 1024 / 1024).toFixed(1);
      const heapPct = (data as any).metrics.memory
        ? Math.round((mem.current / (512 * 1024 * 1024)) * 100)
        : 0;

      document.getElementById('heap-used').textContent = usedMb;
      const bar = document.getElementById('heap-bar');
      bar.style.width = Math.min(heapPct, 100) + '%';
      bar.className   = 'progress-fill ' +
        (heapPct > 90 ? 'fill-red' : heapPct > 70 ? 'fill-yellow' : 'fill-green');
    }

    // ── System load
    const sysLoad = (data as any).metrics && (data as any).metrics.system &&
      (data as any).metrics.system.loadAvg && (data as any).metrics.system.loadAvg[0];
    document.getElementById('sys-load').textContent =
      sysLoad != null ? sysLoad.toFixed(2) : '—';

    // ── Circuit breakers
    const circuits = (data as any).circuits || {};
    const cbEntries = Object.entries(circuits);
    const cbEl = document.getElementById('circuit-breakers');
    if (cbEntries.length === 0) {
      cbEl.textContent = 'No circuit breakers active.';
    } else {
      cbEl.innerHTML = cbEntries.map(([name, cb]) => {
        const color = cb.state === 'OPEN'
          ? 'var(--red)'
          : cb.state === 'HALF_OPEN'
            ? 'var(--yellow)'
            : 'var(--green)';
        return '<span style="margin-right:16px">' +
          '<span style="color:' + color + '">●</span> ' +
          name + ' <span style="color:var(--muted)">(' + cb.state + ')</span>' +
        '</span>';
      }).join('');
    }
  }

  // ── UPTIME TICKER ─────────────────────────────────────────
  function startUptimeTicker() {
    if (uptimeTimer) return;
    uptimeTimer = setInterval(() => {
      if (bootTime) {
        document.getElementById('uptime-display').textContent =
          'uptime: ' + fmtUptime(Date.now() - bootTime);
      }
    }, 1000);
  }

  // ── AGENT ACTIONS ─────────────────────────────────────────
  async function agentAction(id, action) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (API_TOKEN) headers.Authorization = 'Bearer ' + API_TOKEN;

      const res = await fetch(API_BASE + '/agents/' + id + '/' + action, {
        method: 'POST', headers,
      });
      const data = await (res as any).json();
      appendLog((data as any).ok ? 'INFO' : 'ERROR',
        'Agent ' + action + ' [' + id + ']: ' + ((data as any).ok ? 'success' : (data as any).error));
      setTimeout(fetchStatus, 1000);
    } catch (err) {
      appendLog('ERROR', 'Action failed: ' + err.message);
    }
  }

  // ── SSE CONNECTION ────────────────────────────────────────
  function connectSSE() {
    const dot   = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');

    const url = API_BASE + SSE_URL +
      (API_TOKEN ? '?token=' + encodeURIComponent(API_TOKEN) : '');

    const es = new EventSource(url);

    es.onopen = () => {
      dot.className   = 'status-dot dot-green';
      label.textContent = 'live';
      appendLog('INFO', 'SSE stream connected');
    };

    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        appendLog(ev.level || 'INFO', ev.message || JSON.stringify(ev));
        if (ev.type === 'status-update') fetchStatus();
      } catch (_) {
        appendLog('DEBUG', e.data);
      }
    };

    es.onerror = () => {
      dot.className   = 'status-dot dot-red';
      label.textContent = 'reconnecting...';
      appendLog('WARN', 'SSE disconnected — reconnecting in 3s');
    };
  }

  // ── INIT ──────────────────────────────────────────────────
  fetchStatus();
  setInterval(fetchStatus, 5000);
  connectSSE();
  appendLog('INFO', 'KLYN AI OS Dashboard initialised');
</script>
</body>
</html>`;
}

// ─── DASHBOARD SERVER ────────────────────────────────────────
class DashboardServer {
  [key: string]: any;
    #server;
    #orchestrator;
    #logger;
    #port;
    #apiToken;
    #sseClients;     // Set of response objects

    constructor(orchestrator, logger, options: any = {}) {
        this.#orchestrator = orchestrator;
        this.#logger       = logger;
        this.#port         = options.port || 9001;
        this.#apiToken     = process.env.KLYN_API_TOKEN || null;
        this.#sseClients   = new Set();

        this.#server = http.createServer((req, res) =>
            this.#handle(req, res)
        );

        // Forward orchestrator events to all SSE clients
        this.#wireOrchestratorEvents();
    }

    // ── WIRE EVENTS ──────────────────────────────────────────
    #wireOrchestratorEvents() {
        const broadcast = (level, message, data = {}) => {
            this.#broadcast({ level, message, ...(data as any), ts: Date.now() });
        };

        this.#orchestrator.on('agent-crash', (d) =>
            broadcast('ERROR', `Agent crashed: ${d.id}`, d));

        this.#orchestrator.on('agent-failed', (d) =>
            broadcast('FATAL', `Agent permanently failed: ${d.id}`, d));

        this.#orchestrator.on('health', (d) =>
            broadcast('INFO', 'Health check', { type: 'status-update', ...d }));

        this.#orchestrator.on('bug-found', (d) =>
            broadcast('WARN', 'Bug alert', d));
    }

    // ── REQUEST HANDLER ──────────────────────────────────────
    async #handle(req, res) {
        const url = req.url.split('?')[0];

        (res as any).setHeader('Access-Control-Allow-Origin', '*');
        (res as any).setHeader('X-Powered-By', 'KLYN-AI-OS');

        // SSE endpoint
        if (url === '/api/events') {
            return this.#handleSSE(req, res);
        }

        // Dashboard HTML
        if (url === '/' || url === '/dashboard') {
            const html = buildDashboardHTML(this.#apiToken);
            (res as any).writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return (res as any).end(html);
        }

        (res as any).writeHead(404, { 'Content-Type': 'application/json' });
        (res as any).end(JSON.stringify({ error: 'Not Found' }));
    }

    // ── SSE ───────────────────────────────────────────────────
    #handleSSE(req, res) {
        (res as any).writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        (res as any).write('retry: 3000\n\n');
        (res as any).write(`data: ${JSON.stringify({
            level: 'INFO',
            message: 'KLYN AI OS SSE stream active',
            ts: Date.now(),
        })}\n\n`);

        this.#sseClients.add(res);

        req.on('close', () => {
            this.#sseClients.delete(res);
        });
    }

    #broadcast(payload) {
        const line = `data: ${JSON.stringify(payload)}\n\n`;
        for (const client of this.#sseClients) {
            try { client.write(line); } catch (_) {
                this.#sseClients.delete(client);
            }
        }
    }

    // ── LISTEN ────────────────────────────────────────────────
    listen() {
        return new Promise((resolve, reject) => {
            this.#server.listen(this.#port, '127.0.0.1', () => {
                this.#logger?.info(
                    `Dashboard server listening on http://127.0.0.1:${this.#port}`
                );
                // @ts-ignore
                resolve();
            });
            this.#server.once('error', reject);
        });
    }

    close() {
        for (const client of this.#sseClients) {
            try { client.end(); } catch (_) {}
        }
        this.#sseClients.clear();
        return new Promise((resolve) => this.#server.close(resolve));
    }
}

export { DashboardServer };


export {};
