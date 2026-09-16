/**
 * @fileoverview SwarmTerminalUI - Zero-dependency ANSI Terminal Dashboard
 * @module kernel/orchestrator/swarm_terminal_ui
 * 
 * Provides real-time terminal-based dashboard for monitoring Swarm Engine execution,
 * multi-agent status, Merkle DAG synchronization, AST operations, and performance metrics.
 * 
 * @author Klyn AI OS Core Team
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { WriteStream } from 'tty';
import { clearLine, cursorTo, moveCursor } from 'readline';

import type {
  SwarmBenchmark,
  PerformanceMetric,
  AgentExecutionBenchmark,
  ContextExtractionBenchmark,
  ThroughputMetrics,
  MemorySnapshot,
  CacheMetrics,
} from './swarm_benchmark';

/* ===========================
 * ANSI Escape Codes
 * =========================== */

/**
 * ANSI color codes
 */
const ANSI = {
  // Reset
  RESET: '\x1b[0m',
  
  // Text styles
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',
  BLINK: '\x1b[5m',
  REVERSE: '\x1b[7m',
  
  // Foreground colors
  FG_BLACK: '\x1b[30m',
  FG_RED: '\x1b[31m',
  FG_GREEN: '\x1b[32m',
  FG_YELLOW: '\x1b[33m',
  FG_BLUE: '\x1b[34m',
  FG_MAGENTA: '\x1b[35m',
  FG_CYAN: '\x1b[36m',
  FG_WHITE: '\x1b[37m',
  FG_GRAY: '\x1b[90m',
  
  // Bright foreground colors
  FG_BRIGHT_RED: '\x1b[91m',
  FG_BRIGHT_GREEN: '\x1b[92m',
  FG_BRIGHT_YELLOW: '\x1b[93m',
  FG_BRIGHT_BLUE: '\x1b[94m',
  FG_BRIGHT_MAGENTA: '\x1b[95m',
  FG_BRIGHT_CYAN: '\x1b[96m',
  FG_BRIGHT_WHITE: '\x1b[97m',
  
  // Background colors
  BG_BLACK: '\x1b[40m',
  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
  BG_BLUE: '\x1b[44m',
  BG_MAGENTA: '\x1b[45m',
  BG_CYAN: '\x1b[46m',
  BG_WHITE: '\x1b[47m',
  
  // Cursor controls
  CURSOR_UP: (n: number) => `\x1b[${n}A`,
  CURSOR_DOWN: (n: number) => `\x1b[${n}B`,
  CURSOR_FORWARD: (n: number) => `\x1b[${n}C`,
  CURSOR_BACK: (n: number) => `\x1b[${n}D`,
  CURSOR_SAVE: '\x1b[s',
  CURSOR_RESTORE: '\x1b[u',
  CURSOR_HIDE: '\x1b[?25l',
  CURSOR_SHOW: '\x1b[?25h',
  
  // Screen controls
  CLEAR_SCREEN: '\x1b[2J',
  CLEAR_LINE: '\x1b[2K',
  CLEAR_TO_END: '\x1b[0J',
  GOTO_HOME: '\x1b[H',
  GOTO: (row: number, col: number) => `\x1b[${row};${col}H`,
  
  // Alternative screen
  ALT_SCREEN_ON: '\x1b[?1049h',
  ALT_SCREEN_OFF: '\x1b[?1049l',
} as const;

/* ===========================
 * Type Definitions
 * =========================== */

/**
 * Agent status for display
 */
export interface AgentDisplayStatus {
  agentId: string;
  role: string;
  status: 'idle' | 'busy' | 'error' | 'completed';
  currentTask?: string;
  progress?: number;
  tokensProcessed?: number;
  duration?: number;
}

/**
 * Task display info
 */
export interface TaskDisplayInfo {
  taskId: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  agentsAllocated: number;
  agentsCompleted: number;
  startTime?: number;
  duration?: number;
}

/**
 * Dashboard panel type
 */
export type DashboardPanel = 
  | 'header'
  | 'agents'
  | 'tasks'
  | 'metrics'
  | 'logs'
  | 'footer';

/**
 * Log entry
 */
export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  category?: string;
}

/**
 * Terminal UI configuration
 */
export interface SwarmTerminalUIConfig {
  /** Enable color output */
  readonly enableColors?: boolean;
  
  /** Update interval (ms) */
  readonly updateIntervalMs?: number;
  
  /** Maximum log entries to display */
  readonly maxLogEntries?: number;
  
  /** Enable alternate screen buffer */
  readonly useAlternateScreen?: boolean;
  
  /** Panel heights */
  readonly panelHeights?: Readonly<{
    header?: number;
    agents?: number;
    tasks?: number;
    metrics?: number;
    logs?: number;
    footer?: number;
  }>;
  
  /** Show detailed metrics */
  readonly showDetailedMetrics?: boolean;
  
  /** Enable progress bars */
  readonly enableProgressBars?: boolean;
}

/**
 * Dashboard state
 */
interface DashboardState {
  agents: Map<string, AgentDisplayStatus>;
  tasks: Map<string, TaskDisplayInfo>;
  logs: LogEntry[];
  metrics: {
    throughput?: ThroughputMetrics;
    memory?: MemorySnapshot;
    cacheMetrics: CacheMetrics[];
    latestAgentExecution?: AgentExecutionBenchmark;
    latestContextExtraction?: ContextExtractionBenchmark;
  };
  lastUpdate: number;
}

/* ===========================
 * SwarmTerminalUI Implementation
 * =========================== */

/**
 * SwarmTerminalUI - Real-time ANSI Terminal Dashboard
 * 
 * Provides live monitoring and visualization of Swarm Engine operations
 * with color-coded status indicators and performance metrics.
 * 
 * @example
 * ```typescript
 * const ui = new SwarmTerminalUI(benchmark, {
 *   updateIntervalMs: 100,
 *   enableColors: true
 * });
 * 
 * ui.start();
 * 
 * ui.updateAgentStatus('agent-1', {
 *   agentId: 'agent-1',
 *   role: 'CODER',
 *   status: 'busy',
 *   currentTask: 'Implementing auth',
 *   progress: 45
 * });
 * 
 * ui.log('Task started', 'info');
 * ```
 */
export class SwarmTerminalUI extends EventEmitter {
  private readonly config: Required<SwarmTerminalUIConfig>;
  private readonly benchmark: SwarmBenchmark;
  private readonly output: WriteStream;
  
  private readonly state: DashboardState;
  
  private updateTimer: NodeJS.Timeout | null;
  private isRunning: boolean;
  private screenWidth: number;
  private screenHeight: number;
  private lastFrameLines: number;

  /**
   * Creates a new SwarmTerminalUI instance
   */
  constructor(
    benchmark: SwarmBenchmark,
    config: SwarmTerminalUIConfig = {}
  ) {
    super();
    
    this.config = {
      enableColors: config.enableColors ?? true,
      updateIntervalMs: config.updateIntervalMs ?? 100,
      maxLogEntries: config.maxLogEntries ?? 50,
      useAlternateScreen: config.useAlternateScreen ?? true,
      panelHeights: {
        header: config.panelHeights?.header ?? 3,
        agents: config.panelHeights?.agents ?? 8,
        tasks: config.panelHeights?.tasks ?? 6,
        metrics: config.panelHeights?.metrics ?? 8,
        logs: config.panelHeights?.logs ?? 10,
        footer: config.panelHeights?.footer ?? 1,
      },
      showDetailedMetrics: config.showDetailedMetrics ?? true,
      enableProgressBars: config.enableProgressBars ?? true,
    };
    
    this.benchmark = benchmark;
    this.output = process.stdout as WriteStream;
    
    this.state = {
      agents: new Map(),
      tasks: new Map(),
      logs: [],
      metrics: {
        cacheMetrics: [],
      },
      lastUpdate: Date.now(),
    };
    
    this.updateTimer = null;
    this.isRunning = false;
    this.screenWidth = this.output.columns || 80;
    this.screenHeight = this.output.rows || 24;
    this.lastFrameLines = 0;
    
    this.setupEventListeners();
    this.setupResizeHandler();
  }

  /* ===========================
   * Lifecycle Methods
   * =========================== */

  /**
   * Starts the terminal UI
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    
    // Enter alternate screen if enabled
    if (this.config.useAlternateScreen) {
      this.output.write(ANSI.ALT_SCREEN_ON);
    }
    
    // Hide cursor
    this.output.write(ANSI.CURSOR_HIDE);
    
    // Clear screen
    this.clearScreen();
    
    // Start update loop
    this.updateTimer = setInterval(() => {
      this.render();
    }, this.config.updateIntervalMs);
    
    // Initial render
    this.render();
    
    this.log('Terminal UI started', 'success');
  }

  /**
   * Stops the terminal UI
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    // Stop update loop
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    // Show cursor
    this.output.write(ANSI.CURSOR_SHOW);
    
    // Exit alternate screen if enabled
    if (this.config.useAlternateScreen) {
      this.output.write(ANSI.ALT_SCREEN_OFF);
    }
    
    this.log('Terminal UI stopped', 'info');
  }

  /* ===========================
   * State Management
   * =========================== */

  /**
   * Updates agent status
   */
  public updateAgentStatus(
    agentId: string,
    status: AgentDisplayStatus
  ): void {
    this.state.agents.set(agentId, status);
  }

  /**
   * Removes agent from display
   */
  public removeAgent(agentId: string): void {
    this.state.agents.delete(agentId);
  }

  /**
   * Updates task info
   */
  public updateTaskInfo(
    taskId: string,
    info: TaskDisplayInfo
  ): void {
    this.state.tasks.set(taskId, info);
  }

  /**
   * Removes task from display
   */
  public removeTask(taskId: string): void {
    this.state.tasks.delete(taskId);
  }

  /**
   * Logs a message
   */
  public log(
    message: string,
    level: 'info' | 'warn' | 'error' | 'success' = 'info',
    category?: string
  ): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      category,
    };
    
    this.state.logs.push(entry);
    
    // Enforce max log entries
    if (this.state.logs.length > this.config.maxLogEntries) {
      this.state.logs.shift();
    }
  }

  /* ===========================
   * Event Listeners
   * =========================== */

  /**
   * Sets up benchmark event listeners
   */
  private setupEventListeners(): void {
    // Agent execution events
    this.benchmark.on('benchmark:agent-execution', (benchmark: AgentExecutionBenchmark) => {
      this.state.metrics.latestAgentExecution = benchmark;
      
      this.log(
        `Agent ${benchmark.agentId} completed in ${benchmark.executionTimeMs.toFixed(0)}ms`,
        benchmark.success ? 'success' : 'error',
        'agent'
      );
    });
    
    // Context extraction events
    this.benchmark.on('benchmark:context-extraction', (benchmark: ContextExtractionBenchmark) => {
      this.state.metrics.latestContextExtraction = benchmark;
      
      this.log(
        `Context extracted: ${benchmark.symbolsExtracted} symbols in ${benchmark.totalTimeMs.toFixed(0)}ms`,
        'info',
        'context'
      );
    });
    
    // Memory snapshot events
    this.benchmark.on('benchmark:memory-snapshot', (snapshot: MemorySnapshot) => {
      this.state.metrics.memory = snapshot;
    });
    
    // Generic metric events
    this.benchmark.on('metric', (metric: PerformanceMetric) => {
      // Update throughput if available
      if (metric.category === 'throughput') {
        this.state.metrics.throughput = this.benchmark.getThroughputMetrics();
      }
    });
  }

  /**
   * Sets up terminal resize handler
   */
  private setupResizeHandler(): void {
    this.output.on('resize', () => {
      this.screenWidth = this.output.columns || 80;
      this.screenHeight = this.output.rows || 24;
      this.render();
    });
  }

  /* ===========================
   * Rendering Engine
   * =========================== */

  /**
   * Renders the complete dashboard
   */
  private render(): void {
    if (!this.isRunning) {
      return;
    }
    
    // Update metrics from benchmark
    this.updateMetricsFromBenchmark();
    
    // Build frame
    const frame = this.buildFrame();
    
    // Write frame to output
    this.writeFrame(frame);
    
    this.state.lastUpdate = Date.now();
  }

  /**
   * Updates metrics from benchmark
   */
  private updateMetricsFromBenchmark(): void {
    this.state.metrics.throughput = this.benchmark.getThroughputMetrics();
    this.state.metrics.memory = this.benchmark.getCurrentMemoryUsage();
    
    // Update cache metrics
    this.state.metrics.cacheMetrics = [
      this.benchmark.getCacheMetrics('context'),
      this.benchmark.getCacheMetrics('ast_graph'),
      this.benchmark.getCacheMetrics('search'),
    ];
  }

  /**
   * Builds a complete frame
   */
  private buildFrame(): string {
    const lines: string[] = [];
    
    // Header
    lines.push(...this.renderHeader());
    lines.push(this.renderSeparator());
    
    // Agent panel
    lines.push(...this.renderAgentPanel());
    lines.push(this.renderSeparator());
    
    // Task panel
    lines.push(...this.renderTaskPanel());
    lines.push(this.renderSeparator());
    
    // Metrics panel
    lines.push(...this.renderMetricsPanel());
    lines.push(this.renderSeparator());
    
    // Logs panel
    lines.push(...this.renderLogsPanel());
    
    // Footer
    lines.push(this.renderSeparator());
    lines.push(...this.renderFooter());
    
    return lines.join('\n');
  }

  /**
   * Writes frame to output
   */
  private writeFrame(frame: string): void {
    // Move cursor to top
    this.output.write(ANSI.GOTO_HOME);
    
    // Write frame
    this.output.write(frame);
    
    // Clear any remaining lines from previous frame
    const currentLines = frame.split('\n').length;
    if (currentLines < this.lastFrameLines) {
      for (let i = 0; i < this.lastFrameLines - currentLines; i++) {
        this.output.write('\n' + ANSI.CLEAR_LINE);
      }
    }
    
    this.lastFrameLines = currentLines;
  }

  /* ===========================
   * Panel Renderers
   * =========================== */

  /**
   * Renders header panel
   */
  private renderHeader(): string[] {
    const lines: string[] = [];
    const title = ' KLYN AI OS - SWARM ENGINE DASHBOARD ';
    const uptime = this.formatDuration(Date.now() - this.state.lastUpdate);
    
    const titleLine = this.centerText(title, '═');
    lines.push(this.colorize(titleLine, 'BOLD', 'FG_BRIGHT_CYAN'));
    
    const statusLine = this.padRight(
      `  Active Agents: ${this.colorize(this.state.agents.size.toString(), 'FG_BRIGHT_GREEN')}  ` +
      `Active Tasks: ${this.colorize(this.state.tasks.size.toString(), 'FG_BRIGHT_YELLOW')}  ` +
      `Uptime: ${this.colorize(uptime, 'FG_BRIGHT_MAGENTA')}`,
      this.screenWidth
    );
    
    lines.push(statusLine);
    
    return lines;
  }

  /**
   * Renders agent panel
   */
  private renderAgentPanel(): string[] {
    const lines: string[] = [];
    const panelHeight = this.config.panelHeights.agents;
    
    lines.push(this.colorize('  AGENTS', 'BOLD', 'FG_BRIGHT_WHITE'));
    
    if (this.state.agents.size === 0) {
      lines.push(this.colorize('  No active agents', 'DIM', 'FG_GRAY'));
    } else {
      const agents = Array.from(this.state.agents.values()).slice(0, panelHeight - 2);
      
      for (const agent of agents) {
        lines.push(this.renderAgentRow(agent));
      }
    }
    
    // Pad to panel height
    while (lines.length < panelHeight) {
      lines.push('');
    }
    
    return lines;
  }

  /**
   * Renders a single agent row
   */
  private renderAgentRow(agent: AgentDisplayStatus): string {
    const statusIcon = this.getStatusIcon(agent.status);
    const statusColor = this.getStatusColor(agent.status);
    
    const roleText = this.padRight(agent.role, 12);
    const statusText = this.padRight(agent.status.toUpperCase(), 10);
    const taskText = agent.currentTask
      ? this.truncate(agent.currentTask, 30)
      : this.colorize('idle', 'DIM');
    
    let row = `  ${this.colorize(statusIcon, statusColor)} ${roleText} ${this.colorize(statusText, statusColor)} ${taskText}`;
    
    // Add progress bar if available
    if (agent.progress !== undefined && this.config.enableProgressBars) {
      const progressBar = this.renderProgressBar(agent.progress, 20);
      row += ` ${progressBar}`;
    }
    
    // Add duration if available
    if (agent.duration !== undefined) {
      const duration = this.formatDuration(agent.duration);
      row += ` ${this.colorize(duration, 'FG_GRAY')}`;
    }
    
    return row;
  }

  /**
   * Renders task panel
   */
  private renderTaskPanel(): string[] {
    const lines: string[] = [];
    const panelHeight = this.config.panelHeights.tasks;
    
    lines.push(this.colorize('  TASKS', 'BOLD', 'FG_BRIGHT_WHITE'));
    
    if (this.state.tasks.size === 0) {
      lines.push(this.colorize('  No active tasks', 'DIM', 'FG_GRAY'));
    } else {
      const tasks = Array.from(this.state.tasks.values()).slice(0, panelHeight - 2);
      
      for (const task of tasks) {
        lines.push(this.renderTaskRow(task));
      }
    }
    
    // Pad to panel height
    while (lines.length < panelHeight) {
      lines.push('');
    }
    
    return lines;
  }

  /**
   * Renders a single task row
   */
  private renderTaskRow(task: TaskDisplayInfo): string {
    const statusIcon = this.getStatusIcon(task.status as AgentDisplayStatus['status']);
    const statusColor = this.getStatusColor(task.status as AgentDisplayStatus['status']);
    
    const description = this.truncate(task.description, 40);
    const statusText = this.padRight(task.status.toUpperCase(), 10);
    const agentText = `${task.agentsCompleted}/${task.agentsAllocated}`;
    
    let row = `  ${this.colorize(statusIcon, statusColor)} ${description} ${this.colorize(statusText, statusColor)} Agents: ${agentText}`;
    
    // Add progress bar
    if (this.config.enableProgressBars) {
      const progressBar = this.renderProgressBar(task.progress, 15);
      row += ` ${progressBar}`;
    }
    
    return row;
  }

  /**
   * Renders metrics panel
   */
  private renderMetricsPanel(): string[] {
    const lines: string[] = [];
    
    lines.push(this.colorize('  PERFORMANCE METRICS', 'BOLD', 'FG_BRIGHT_WHITE'));
    
    // Throughput metrics
    if (this.state.metrics.throughput) {
      const tp = this.state.metrics.throughput;
      lines.push(
        `  ${this.colorize('Throughput:', 'FG_CYAN')} ` +
        `${this.colorize(tp.tasksPerSecond.toFixed(2), 'FG_BRIGHT_GREEN')} tasks/s  ` +
        `${this.colorize(tp.tokensPerSecond.toFixed(0), 'FG_BRIGHT_YELLOW')} tokens/s  ` +
        `${this.colorize(tp.filesPerSecond.toFixed(2), 'FG_BRIGHT_BLUE')} files/s`
      );
      
      lines.push(
        `  ${this.colorize('Latency:', 'FG_CYAN')} ` +
        `Avg: ${this.colorize(tp.avgTaskLatencyMs.toFixed(0) + 'ms', 'FG_GREEN')}  ` +
        `P95: ${this.colorize(tp.p95TaskLatencyMs.toFixed(0) + 'ms', 'FG_YELLOW')}  ` +
        `P99: ${this.colorize(tp.p99TaskLatencyMs.toFixed(0) + 'ms', 'FG_RED')}`
      );
    }
    
    // Memory metrics
    if (this.state.metrics.memory) {
      const mem = this.state.metrics.memory;
      lines.push(
        `  ${this.colorize('Memory:', 'FG_CYAN')} ` +
        `Heap: ${this.colorize(mem.heapUsedMB.toFixed(1) + 'MB', 'FG_BRIGHT_MAGENTA')}  ` +
        `RSS: ${this.colorize(mem.rssMB.toFixed(1) + 'MB', 'FG_MAGENTA')}`
      );
    }
    
    // Cache metrics
    if (this.state.metrics.cacheMetrics.length > 0) {
      lines.push(`  ${this.colorize('Cache Hit Rates:', 'FG_CYAN')}`);
      
      for (const cache of this.state.metrics.cacheMetrics) {
        if (cache.totalRequests > 0) {
          const hitRateColor = cache.hitRate > 80 ? 'FG_BRIGHT_GREEN' :
                               cache.hitRate > 50 ? 'FG_YELLOW' : 'FG_RED';
          
          lines.push(
            `    ${this.padRight(cache.cacheName, 12)}: ` +
            `${this.colorize(cache.hitRate.toFixed(1) + '%', hitRateColor)} ` +
            `(${cache.hits}/${cache.totalRequests})`
          );
        }
      }
    }
    
    // Latest operation timings
    if (this.state.metrics.latestAgentExecution) {
      const exec = this.state.metrics.latestAgentExecution;
      lines.push(
        `  ${this.colorize('Last Agent:', 'FG_CYAN')} ` +
        `${exec.executionTimeMs.toFixed(0)}ms  ` +
        `${this.colorize(exec.tokensPerSecond.toFixed(0), 'FG_BRIGHT_YELLOW')} tokens/s`
      );
    }
    
    if (this.state.metrics.latestContextExtraction) {
      const ctx = this.state.metrics.latestContextExtraction;
      lines.push(
        `  ${this.colorize('Last Context:', 'FG_CYAN')} ` +
        `${ctx.totalTimeMs.toFixed(0)}ms  ` +
        `${ctx.symbolsExtracted} symbols  ` +
        `${this.colorize(ctx.cacheHit ? 'HIT' : 'MISS', ctx.cacheHit ? 'FG_GREEN' : 'FG_RED')}`
      );
    }
    
    // Pad to panel height
    const panelHeight = this.config.panelHeights.metrics;
    while (lines.length < panelHeight) {
      lines.push('');
    }
    
    return lines;
  }

  /**
   * Renders logs panel
   */
  private renderLogsPanel(): string[] {
    const lines: string[] = [];
    const panelHeight = this.config.panelHeights.logs;
    
    lines.push(this.colorize('  LOGS', 'BOLD', 'FG_BRIGHT_WHITE'));
    
    if (this.state.logs.length === 0) {
      lines.push(this.colorize('  No logs', 'DIM', 'FG_GRAY'));
    } else {
      // Show most recent logs
      const recentLogs = this.state.logs.slice(-1 * (panelHeight - 2));
      
      for (const log of recentLogs) {
        lines.push(this.renderLogEntry(log));
      }
    }
    
    // Pad to panel height
    while (lines.length < panelHeight) {
      lines.push('');
    }
    
    return lines;
  }

  /**
   * Renders a single log entry
   */
  private renderLogEntry(log: LogEntry): string {
    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    const levelIcon = this.getLogLevelIcon(log.level);
    const levelColor = this.getLogLevelColor(log.level);
    
    const category = log.category
      ? this.colorize(`[${log.category}]`, 'FG_GRAY')
      : '';
    
    return `  ${this.colorize(timestamp, 'FG_GRAY')} ${this.colorize(levelIcon, levelColor)} ${category} ${log.message}`;
  }

  /**
   * Renders footer panel
   */
  private renderFooter(): string[] {
    const lines: string[] = [];
    
    const footerText = this.padRight(
      `  Press Ctrl+C to exit  |  Last update: ${new Date().toLocaleTimeString()}`,
      this.screenWidth
    );
    
    lines.push(this.colorize(footerText, 'DIM', 'FG_GRAY'));
    
    return lines;
  }

  /* ===========================
   * Rendering Utilities
   * =========================== */

  /**
   * Renders a progress bar
   */
  private renderProgressBar(percent: number, width: number): string {
    const filled = Math.floor((percent / 100) * width);
    const empty = width - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percentText = `${percent.toFixed(0)}%`;
    
    return `${this.colorize(bar, 'FG_BRIGHT_BLUE')} ${this.colorize(percentText, 'FG_CYAN')}`;
  }

  /**
   * Renders a separator line
   */
  private renderSeparator(char: string = '─'): string {
    return this.colorize(char.repeat(this.screenWidth), 'DIM', 'FG_GRAY');
  }

  /**
   * Gets status icon
   */
  private getStatusIcon(status: AgentDisplayStatus['status']): string {
    const icons = {
      idle: '○',
      busy: '●',
      error: '✖',
      completed: '✓',
    };
    
    return icons[status] || '?';
  }

  /**
   * Gets status color
   */
  private getStatusColor(status: AgentDisplayStatus['status']): keyof typeof ANSI {
    const colors: Record<AgentDisplayStatus['status'], keyof typeof ANSI> = {
      idle: 'FG_GRAY',
      busy: 'FG_BRIGHT_YELLOW',
      error: 'FG_BRIGHT_RED',
      completed: 'FG_BRIGHT_GREEN',
    };
    
    return colors[status] || 'FG_WHITE';
  }

  /**
   * Gets log level icon
   */
  private getLogLevelIcon(level: LogEntry['level']): string {
    const icons = {
      info: 'ℹ',
      warn: '⚠',
      error: '✖',
      success: '✓',
    };
    
    return icons[level] || '•';
  }

  /**
   * Gets log level color
   */
  private getLogLevelColor(level: LogEntry['level']): keyof typeof ANSI {
    const colors: Record<LogEntry['level'], keyof typeof ANSI> = {
      info: 'FG_BLUE',
      warn: 'FG_YELLOW',
      error: 'FG_RED',
      success: 'FG_GREEN',
    };
    
    return colors[level] || 'FG_WHITE';
  }

  /* ===========================
   * Text Utilities
   * =========================== */

  /**
   * Colorizes text with ANSI codes
   */
  private colorize(
    text: string,
    ...styles: Array<keyof typeof ANSI>
  ): string {
    if (!this.config.enableColors) {
      return text;
    }
    
    const codes = styles.map(style => ANSI[style]).join('');
    return `${codes}${text}${ANSI.RESET}`;
  }

  /**
   * Centers text with padding
   */
  private centerText(text: string, padChar: string = ' '): string {
    const textLength = this.stripAnsi(text).length;
    const totalPadding = this.screenWidth - textLength;
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = Math.ceil(totalPadding / 2);
    
    return padChar.repeat(leftPadding) + text + padChar.repeat(rightPadding);
  }

  /**
   * Pads text to the right
   */
  private padRight(text: string, width: number): string {
    const textLength = this.stripAnsi(text).length;
    const padding = Math.max(0, width - textLength);
    return text + ' '.repeat(padding);
  }

  /**
   * Truncates text with ellipsis
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Strips ANSI escape codes from text
   */
  private stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Formats duration in human-readable form
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`;
    }
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    
    return `${seconds}s`;
  }

  /* ===========================
   * Screen Utilities
   * =========================== */

  /**
   * Clears the screen
   */
  private clearScreen(): void {
    this.output.write(ANSI.CLEAR_SCREEN);
    this.output.write(ANSI.GOTO_HOME);
  }
}

/* ===========================
 * Factory & Exports
 * =========================== */

/**
 * Creates a new SwarmTerminalUI instance
 */
export function createSwarmTerminalUI(
  benchmark: SwarmBenchmark,
  config?: SwarmTerminalUIConfig
): SwarmTerminalUI {
  return new SwarmTerminalUI(benchmark, config);
}

export default SwarmTerminalUI;
