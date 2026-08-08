// =============================================================================
// KLYN AI OS — 2.body — System Monitor (Phase 10)
// File: 2.body/sysmon.ts
//
// Deep system telemetry monitor. Watches processes (shell-slot children and
// arbitrary pids) and classifies their exits at the OS boundary:
//
//   - signal-terminated  -> `panic`  (segfault, OOM-kill, SIGKILL, ...)
//   - non-zero exit      -> `error`
//   - zero exit          -> `ok`
//   - pid vanished (unknown code) -> `exit`
//
// Every event is emitted through an optional sink, published on the kernel
// bus (`system.panic` / `system.error` / `system.ok` / `system.exit`), and
// fed into a FutureSimulator as `sys://<label>:<pid>` pseudo-path change
// events — so the world-model's predictive loop learns which labels panic
// together, and the healer/forecaster can pre-warm around recurring panics.
//
// The sampling/waiting is delegated to TelemetryBridge: native pidfd on a
// Rust host, /proc polling everywhere else.
// =============================================================================

import type { ChildProcess } from 'node:child_process';
import { kernelBus } from '../0.kernel/bus.ts';
import type { EventType } from '../0.kernel/types.ts';
import { TelemetryBridge, type ProcessSample } from '../1.bridge/src/telemetry_bridge.js';
import type { ChangeEvent } from '../world-model/prediction/FutureSimulator.js';

export type SystemEventKind = 'ok' | 'error' | 'panic' | 'exit';

export interface SystemEvent {
  kind: SystemEventKind;
  pid: number;
  /** Human-readable label (e.g. "shell-slot", "agent", or a file path). */
  label: string;
  exitCode: number | null;
  signal: string | null;
  at: number;
  /** Best-effort final sample (alive:false once the process is gone). */
  sample?: ProcessSample;
}

export interface SysmonOptions {
  /** Poll interval for non-child watched pids. Default 200ms. */
  pollMs?: number;
  bridge?: TelemetryBridge;
  sink?: (event: SystemEvent) => void;
  /** FutureSimulator.feed-compatible consumer for `sys://` change events. */
  feed?: (changes: ChangeEvent[]) => void;
}

const EVENT_TYPES: Record<SystemEventKind, EventType> = {
  ok: 'system.ok',
  error: 'system.error',
  panic: 'system.panic',
  exit: 'system.exit',
};

function classify(exitCode: number | null, signal: string | null): SystemEventKind {
  if (signal) return 'panic';
  if (exitCode !== null && exitCode !== 0) return 'error';
  return 'ok';
}

export class SystemMonitor {
  private readonly bridge: TelemetryBridge;
  private readonly pollMs: number;
  private readonly sink?: (event: SystemEvent) => void;
  private readonly feed?: (changes: ChangeEvent[]) => void;
  /** Pids watched via polling (not children of this process). */
  private watched = new Map<number, { label: string }>();
  /** Children attached with exit handlers (deterministic code + signal). */
  private children = new Map<number, { label: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SysmonOptions = {}) {
    this.bridge = options.bridge ?? new TelemetryBridge();
    this.pollMs = options.pollMs ?? 200;
    this.sink = options.sink;
    this.feed = options.feed;
  }

  get backend(): 'native' | 'js' {
    return this.bridge.backend;
  }

  get watchedCount(): number {
    return this.watched.size + this.children.size;
  }

  /** Monitor a process we spawned: exit code + signal are exact. */
  attach(child: ChildProcess, label: string): void {
    const pid = child.pid;
    if (!pid) return;
    this.children.set(pid, { label });
    child.once('exit', (code, signal) => {
      this.children.delete(pid);
      this.watched.delete(pid);
      this.emitEvent({
        kind: classify(code, signal),
        pid,
        label,
        exitCode: code ?? (signal ? -1 : null),
        signal: signal ?? null,
        at: Date.now(),
        sample: this.bridge.sample(pid),
      });
    });
  }

  /** Monitor an arbitrary pid by polling /proc until it disappears. */
  watch(pid: number, label: string): void {
    this.watched.set(pid, { label });
  }

  unwatch(pid: number): void {
    this.watched.delete(pid);
    this.children.delete(pid);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(): void {
    for (const [pid, entry] of Array.from(this.watched)) {
      const sample = this.bridge.sample(pid);
      if (!sample.alive) {
        this.watched.delete(pid);
        this.emitEvent({
          kind: 'exit',
          pid,
          label: entry.label,
          exitCode: null,
          signal: null,
          at: Date.now(),
          sample,
        });
      }
    }
  }

  private emitEvent(event: SystemEvent): void {
    this.sink?.(event);
    try {
      kernelBus.publish(EVENT_TYPES[event.kind], event, 'sysmon', String(event.pid));
    } catch {
      /* bus is optional — never let telemetry take the runtime down */
    }
    if (this.feed) {
      this.feed([
        {
          path: `sys://${event.label}:${event.pid}`,
          timestamp: event.at,
          weight: event.kind === 'panic' ? 3 : 1,
        },
      ]);
    }
  }
}

/** Convenience: one monitor wired to a FutureSimulator (and optional sink). */
export function createSystemMonitor(
  simulator: { feed(changes: ChangeEvent[]): void },
  sink?: (event: SystemEvent) => void,
  pollMs = 200
): SystemMonitor {
  return new SystemMonitor({
    pollMs,
    sink,
    feed: (changes) => simulator.feed(changes),
  });
}

export default SystemMonitor;
