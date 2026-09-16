// =============================================================================
// KLYN AI OS — Persistent Stdio Shell Slot (Phase 2)
// File: 2.body/pool/shell-slot.ts
//
// A long-lived shell process with piped stdin/stdout/stderr. Commands are
// executed by writing to stdin and reading until sentinel markers — no process
// spawn, no module load, no shell fork per step. Warm execution overhead is
// sub-millisecond; only a dead or timed-out slot pays a re-spawn cost.
//
// Protocol (single stdin write per command):
//   [export K='V'; ...]            optional per-run env overrides
//   <command>
//   echo __KLYN_EXIT_<id>:$?       stdout sentinel carrying the exit code
//   echo __KLYN_SERR_<id> >&2      stderr sentinel — deterministic stream end
//
// NOTE: stream collection uses classic 'data' listeners, not async iteration —
// Bun does not drive for-await over child_process pipe streams.
// =============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export interface ShellSlotOptions {
  workingDirectory: string;
  shell?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SlotRunOptions {
  /** Per-run env overrides — exported into the shell for this command only. */
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface SlotRunResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ShellSlot {
  readonly id: string;
  readonly workingDirectory: string;
  readonly createdAt: number;
  private child: ChildProcess;
  private shellPath: string;
  private extraEnv: NodeJS.ProcessEnv;
  private busyFlag = false;
  private deadFlag = false;
  lastUsedAt: number;

  constructor(options: ShellSlotOptions) {
    this.id = randomBytes(6).toString('hex');
    this.workingDirectory = options.workingDirectory;
    this.shellPath = options.shell ?? 'bash';
    this.extraEnv = options.env ?? {};
    this.createdAt = Date.now();
    this.lastUsedAt = Date.now();

    this.child = spawn(this.shellPath, [], {
      cwd: this.workingDirectory,
      env: { ...process.env, ...this.extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.on('exit', () => {
      this.deadFlag = true;
    });
    this.child.on('error', () => {
      this.deadFlag = true;
    });
  }

  static create(options: ShellSlotOptions): ShellSlot {
    return new ShellSlot(options);
  }

  get busy(): boolean {
    return this.busyFlag;
  }

  get dead(): boolean {
    return this.deadFlag || this.child.exitCode !== null;
  }

  isHealthy(): boolean {
    return !this.deadFlag && this.child.exitCode === null && this.child.signalCode === null;
  }

  markBusy(): void {
    this.busyFlag = true;
    this.lastUsedAt = Date.now();
  }

  markIdle(): void {
    this.busyFlag = false;
    this.lastUsedAt = Date.now();
  }

  /**
   * Execute one command on this slot. Single-flight: the pool guarantees no
   * two commands run on the same slot concurrently.
   */
  run(command: string, options: SlotRunOptions = {}): Promise<SlotRunResult> {
    const start = performance.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = this.child;

    if (!this.isHealthy()) {
      return Promise.resolve({
        success: false,
        exitCode: child.exitCode ?? 1,
        stdout: '',
        stderr: '',
        durationMs: 0,
        killed: false,
        error: 'shell slot is dead',
      });
    }

    const id = randomBytes(8).toString('hex');
    const envLines = Object.entries(options.env ?? {}).map(
      ([k, v]) => `export ${k}=${JSON.stringify(String(v))};`
    );
    const payload = [...envLines, command, `echo __KLYN_EXIT_${id}:$?`, `echo __KLYN_SERR_${id} >&2`, ''].join('\n');

    const stdoutMarker = `__KLYN_EXIT_${id}:`;
    const stderrMarker = `__KLYN_SERR_${id}`;

    this.busyFlag = true;
    this.lastUsedAt = Date.now();

    return new Promise<SlotRunResult>((resolve) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let exitCode = -1;
      let killed = false;
      let timedOut = false;
      let error: string | undefined;
      let stdoutDone = false;
      let stderrDone = false;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.removeAllListeners('data');
        child.stderr?.removeAllListeners('data');
        child.removeListener('exit', onExit);
        const durationMs = performance.now() - start;
        if (timedOut) error = `command timed out after ${timeoutMs}ms`;
        resolve({
          success: !timedOut && exitCode === 0,
          exitCode: timedOut ? 124 : exitCode,
          stdout: stdoutBuf,
          stderr: stderrBuf,
          durationMs,
          killed,
          error,
        });
      };

      const onStdout = (d: Buffer) => {
        stdoutBuf += d.toString();
        const idx = stdoutBuf.indexOf(stdoutMarker);
        if (idx !== -1) {
          const rest = stdoutBuf.slice(idx + stdoutMarker.length);
          const m = rest.match(/^(\d+)/);
          if (m) exitCode = parseInt(m[1], 10);
          stdoutBuf = stdoutBuf.slice(0, idx).replace(/\n$/, '');
          stdoutDone = true;
          child.stdout?.removeListener('data', onStdout);
        }
        if (stdoutDone && stderrDone) finish();
      };

      const onStderr = (d: Buffer) => {
        stderrBuf += d.toString();
        const idx = stderrBuf.indexOf(stderrMarker);
        if (idx !== -1) {
          stderrBuf = stderrBuf.slice(0, idx).replace(/\n$/, '');
          stderrDone = true;
          child.stderr?.removeListener('data', onStderr);
        }
        if (stdoutDone && stderrDone) finish();
      };

      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);

      // Crash safety: if the shell dies before the markers, settle with what we have.
      const onExit = (code: number | null) => {
        if (!settled) {
          if (exitCode === -1) exitCode = code ?? 1;
          if (stdoutDone || stderrDone || code !== null) finish();
        }
      };
      child.once('exit', onExit);

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        this.deadFlag = true;
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
          }, 500).unref?.();
        } catch {
          /* already gone */
        }
        finish();
      }, timeoutMs);

      try {
        child.stdin?.write(payload);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        finish();
      }
    });
  }

  /** Kill the shell and mark the slot for recycling. */
  recycle(): void {
    this.deadFlag = true;
    try {
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill('SIGKILL');
      }, 300).unref?.();
    } catch {
      /* already gone */
    }
  }

  dispose(): void {
    this.deadFlag = true;
    try {
      this.child.stdin?.end();
      this.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

export default ShellSlot;
