import { readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { SecretMasker } from "./secret-masker.js";

export interface ProcessSandboxRequest {
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  allowedEnv?: readonly string[];
  timeoutMs?: number;
  memoryMb?: number;
  maxOutputBytes?: number;
  fenceKey?: string;
  ownerId?: string;
}

export interface ProcessSandboxResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  memoryExceeded: boolean;
}

export interface ProcessSandboxPolicy {
  maxTimeoutMs: number;
  maxMemoryMb: number;
  maxOutputBytes: number;
  allowedCommands: ReadonlySet<string>;
}

export const DEFAULT_PROCESS_SANDBOX_POLICY: ProcessSandboxPolicy = {
  maxTimeoutMs: 30_000,
  maxMemoryMb: 512,
  maxOutputBytes: 1_000_000,
  allowedCommands: new Set(["node", "python", "python3", "deno", "bun", "cargo", "rustc"]),
};

/**
 * Host-process safety boundary. This is deliberately not a container escape
 * boundary: production deployments must place the manager inside an OS/container
 * sandbox with dropped privileges, seccomp/AppArmor, filesystem and network policy.
 */
export class ProcessSandboxManager {
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly policy: ProcessSandboxPolicy = DEFAULT_PROCESS_SANDBOX_POLICY,
    private readonly secretMasker = new SecretMasker(),
  ) {}

  execute(request: ProcessSandboxRequest): Promise<ProcessSandboxResult> {
    this.validate(request);
    const fenceKey = request.fenceKey;
    const ownerId = request.ownerId;
    if (fenceKey && ownerId && !this.acquireFence(fenceKey, ownerId)) {
      return Promise.reject(new Error(`Execution fence is held: ${fenceKey}`));
    }

    const timeoutMs = Math.min(request.timeoutMs ?? this.policy.maxTimeoutMs, this.policy.maxTimeoutMs);
    const memoryMb = Math.min(request.memoryMb ?? this.policy.maxMemoryMb, this.policy.maxMemoryMb);
    const maxOutputBytes = Math.min(request.maxOutputBytes ?? this.policy.maxOutputBytes, this.policy.maxOutputBytes);
    const env = this.secretMasker.maskEnvironment(request.env ?? process.env, request.allowedEnv ?? []);
    const started = Date.now();

    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(request.command, [...(request.args ?? [])], {
          cwd: request.cwd,
          env,
          shell: false,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        if (fenceKey && ownerId) this.releaseFence(fenceKey, ownerId);
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let memoryExceeded = false;
      let settled = false;
      let memoryTimer: ReturnType<typeof globalThis.setInterval> | undefined;
      const timeoutTimer = globalThis.setTimeout(() => {
        timedOut = true;
        this.terminate(child);
      }, timeoutMs);

      const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
        if (settled) return;
        const currentBytes = Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8");
        const remaining = Math.max(0, maxOutputBytes - currentBytes);
        const text = chunk.toString("utf8", 0, Math.min(chunk.byteLength, remaining));
        if (target === "stdout") stdout += text;
        else stderr += text;
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          stderr += "\n[Sandbox output limit exceeded]";
          this.terminate(child);
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

      memoryTimer = globalThis.setInterval(() => {
        const rss = child.pid ? this.readResidentMemoryBytes(child.pid) : 0;
        if (rss > memoryMb * 1024 * 1024) {
          memoryExceeded = true;
          this.terminate(child);
        }
      }, 100);

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutTimer);
        if (memoryTimer !== undefined) globalThis.clearInterval(memoryTimer);
        if (fenceKey && ownerId) this.releaseFence(fenceKey, ownerId);
        if (error) {
          reject(error);
          return;
        }
        resolve({
          exitCode: child.exitCode,
          signal: child.signalCode,
          stdout: this.secretMasker.redact(stdout),
          stderr: this.secretMasker.redact(stderr),
          durationMs: Date.now() - started,
          timedOut,
          memoryExceeded,
        });
      };

      child.once("error", (error) => finish(error));
      child.once("close", () => finish());
    });
  }

  acquireFence(key: string, ownerId: string): boolean {
    const current = this.owners.get(key);
    if (current !== undefined && current !== ownerId) return false;
    this.owners.set(key, ownerId);
    return true;
  }

  releaseFence(key: string, ownerId: string): boolean {
    if (this.owners.get(key) !== ownerId) return false;
    this.owners.delete(key);
    return true;
  }

  private validate(request: ProcessSandboxRequest): void {
    if (!this.policy.allowedCommands.has(request.command)) {
      throw new Error(`Command is not permitted: ${request.command}`);
    }
    if (!request.cwd) throw new Error("cwd is required");
    if (!Number.isInteger(request.timeoutMs ?? this.policy.maxTimeoutMs) || (request.timeoutMs ?? this.policy.maxTimeoutMs) <= 0) {
      throw new Error("timeoutMs must be a positive integer");
    }
    if (!Number.isInteger(request.memoryMb ?? this.policy.maxMemoryMb) || (request.memoryMb ?? this.policy.maxMemoryMb) <= 0) {
      throw new Error("memoryMb must be a positive integer");
    }
  }

  private terminate(child: ChildProcess): void {
    if (child.killed) return;
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
        return;
      } catch {
        // Fall back to the direct child when process-group fencing is unavailable.
      }
    }
    child.kill("SIGKILL");
  }

  private readResidentMemoryBytes(pid: number): number {
    if (process.platform !== "linux") return 0;
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
      return match ? Number(match[1]) * 1024 : 0;
    } catch {
      return 0;
    }
  }
}
