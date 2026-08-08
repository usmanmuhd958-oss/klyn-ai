// =============================================================================
// KLYN AI OS — 1.bridge — System Telemetry Bridge (Phase 10)
// File: 1.bridge/src/telemetry_bridge.ts
//
// Deep system telemetry surface: process sampling + exit waiting.
//
//   - Native path: the 0.kernel napi addon (`0.kernel/target/{release,debug}/
//     klyn_kernel_core.*.node`, built with `cargo build --release` on a Rust
//     host) exposes `sample_process` (sub-100µs /proc snapshot) and
//     `pidfd_wait` (kernel-boundary exit notification with the exact exit
//     code / terminating signal via pidfd_open + waitid).
//   - JS fallback: /proc parsing + 25ms poll. Keeps the runtime and the
//     15/15 smoke suite green on any host without a Rust toolchain.
//
// `sample(pid)` is always safe to call (returns alive:false for unknown
// pids); `waitExit(pid, ms)` resolves the moment the pid is gone.
// =============================================================================

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

export interface ProcessSample {
  pid: number;
  alive: boolean;
  rssKb: number;
  utimeMs: number;
  stimeMs: number;
  threads: number;
  readBytes: number;
  writeBytes: number;
}

export interface ProcessExit {
  pid: number;
  exited: boolean;
  /** Exit code, or -1 when the process was terminated by a signal. */
  exitCode: number;
  /** Signal name (e.g. "SIGSEGV", "SIGKILL") or empty when it exited normally. */
  signal: string;
  /** Time spent waiting, in milliseconds. */
  waitedMs: number;
}

interface NativeTelemetryModule {
  sample_process?: (pid: number) => ProcessSample | null;
  pidfd_wait?: (pid: number, timeoutMs: number) => ProcessExit | null;
}

function loadNativeModule(): NativeTelemetryModule | null {
  const probeDirs = [
    join(__dirname, '../../0.kernel/target/release'),
    join(__dirname, '../../0.kernel/target/debug'),
  ];
  for (const dir of probeDirs) {
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => f.endsWith('.node') && f.includes('klyn_kernel_core'));
    if (!file) continue;
    try {
      const require_ = createRequire(join(__dirname, 'package.json'));
      return require_(join(dir, file)) as NativeTelemetryModule;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** CLK_TCK on Linux — 100 ticks/s on the overwhelming majority of kernels. */
const TICKS_PER_SEC = 100;

/** JS /proc fallback for `sample_process`. */
function sampleProcJs(pid: number): ProcessSample {
  const dead: ProcessSample = {
    pid,
    alive: false,
    rssKb: 0,
    utimeMs: 0,
    stimeMs: 0,
    threads: 0,
    readBytes: 0,
    writeBytes: 0,
  };
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return dead;
  }
  const afterComm = stat.slice(stat.lastIndexOf(')') + 1);
  const f = afterComm.trim().split(/\s+/);
  const get = (n: number): number => {
    const v = Number(f[n - 3]);
    return Number.isFinite(v) ? v : 0;
  };
  const ut = get(14);
  const st = get(15);
  const threads = get(20);
  const rssKb = get(24) * 4; // 4 KiB pages

  let readBytes = 0;
  let writeBytes = 0;
  try {
    const io = readFileSync(`/proc/${pid}/io`, 'utf8');
    for (const line of io.split('\n')) {
      const m = line.match(/^(read_bytes|write_bytes):\s+(\d+)/);
      if (m) {
        if (m[1] === 'read_bytes') readBytes = Number(m[2]);
        else writeBytes = Number(m[2]);
      }
    }
  } catch {
    /* permission denied for non-owned processes — best effort */
  }
  return {
    pid,
    alive: true,
    rssKb,
    utimeMs: Math.round((ut * 1000) / TICKS_PER_SEC),
    stimeMs: Math.round((st * 1000) / TICKS_PER_SEC),
    threads,
    readBytes,
    writeBytes,
  };
}

/** JS fallback for `pidfd_wait`: poll /proc/<pid> until it disappears. */
async function pollProcExit(pid: number, timeoutMs: number): Promise<ProcessExit> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!existsSync(`/proc/${pid}`)) {
      return { pid, exited: true, exitCode: -1, signal: '', waitedMs: Date.now() - start };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { pid, exited: false, exitCode: -1, signal: '', waitedMs: timeoutMs };
}

export class TelemetryBridge {
  readonly available: boolean = false;
  readonly backend: 'native' | 'js' = 'js';
  private native: NativeTelemetryModule | null = null;

  constructor() {
    try {
      const mod = loadNativeModule();
      if (mod && typeof mod.sample_process === 'function' && typeof mod.pidfd_wait === 'function') {
        this.native = mod;
        this.available = true;
        this.backend = 'native';
      }
    } catch {
      /* keep JS fallback */
    }
  }

  /** Snapshot one process; alive:false when the pid is gone or invalid. */
  public sample(pid: number): ProcessSample {
    if (this.available && this.native && this.native.sample_process) {
      try {
        const s = this.native.sample_process(pid);
        if (s) return s;
      } catch {
        /* fall through */
      }
    }
    return sampleProcJs(pid);
  }

  /** Wait for a process to exit (pidfd on native; /proc poll on JS). */
  public async waitExit(pid: number, timeoutMs = 30_000): Promise<ProcessExit> {
    if (this.available && this.native && this.native.pidfd_wait) {
      try {
        const e = this.native.pidfd_wait(pid, timeoutMs);
        if (e) return e;
      } catch {
        /* fall through */
      }
    }
    return pollProcExit(pid, timeoutMs);
  }
}

/** Canonical singleton used by the SystemMonitor when none is supplied. */
export const telemetryBridge: TelemetryBridge = new TelemetryBridge();

export default TelemetryBridge;
