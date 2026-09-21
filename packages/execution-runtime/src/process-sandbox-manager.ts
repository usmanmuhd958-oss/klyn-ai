import { existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SecretMasker } from "./secret-masker.js";

export interface ProcessSandboxRequest {
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  allowedEnv?: readonly string[];
  timeoutMs?: number;
  memoryMb?: number;
  maxCpuMs?: number;
  maxFileDescriptors?: number;
  maxOutputBytes?: number;
  ioReadBps?: number;
  ioWriteBps?: number;
  rootfs?: string;
  fenceKey?: string;
  ownerId?: string;
}

export type ProcessTerminationReason = "timeout" | "memory" | "cpu" | "file-descriptors" | "output";

export interface ProcessSandboxResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  memoryExceeded: boolean;
  resourceLimitExceeded: boolean;
  terminationReason?: ProcessTerminationReason;
}

export interface ProcessSandboxPolicy {
  maxTimeoutMs: number;
  maxMemoryMb: number;
  maxOutputBytes: number;
  maxCpuMs: number;
  maxFileDescriptors: number;
  allowedCommands: ReadonlySet<string>;
  nativeHelperPath?: string;
  rootfs?: string;
  syscallProfile: "strict-linux-v1";
  ioReadBps?: number;
  ioWriteBps?: number;
}

export const DEFAULT_PROCESS_SANDBOX_POLICY: ProcessSandboxPolicy = {
  maxTimeoutMs: 30_000,
  maxMemoryMb: 512,
  maxOutputBytes: 1_000_000,
  maxCpuMs: 30_000,
  maxFileDescriptors: 256,
  // Absolute paths only. Empty is intentional: production configuration must
  // explicitly identify binaries inside the immutable sandbox rootfs.
  allowedCommands: new Set(),
  nativeHelperPath: process.env.KLYN_SANDBOX_HELPER,
  rootfs: process.env.KLYN_SANDBOX_ROOTFS,
  syscallProfile: "strict-linux-v1",
  ioReadBps: 50 * 1024 * 1024,
  ioWriteBps: 50 * 1024 * 1024,
};

function helperDefaultPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../native-sandbox/target/release/klyn-sandbox");
}

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
    const maxCpuMs = Math.min(request.maxCpuMs ?? this.policy.maxCpuMs, this.policy.maxCpuMs);
    const maxFileDescriptors = Math.min(request.maxFileDescriptors ?? this.policy.maxFileDescriptors, this.policy.maxFileDescriptors);
    const maxOutputBytes = Math.min(request.maxOutputBytes ?? this.policy.maxOutputBytes, this.policy.maxOutputBytes);
    const rootfs = request.rootfs ?? this.policy.rootfs;
    const helper = this.policy.nativeHelperPath ?? helperDefaultPath();
    const sourceEnv = request.env ?? process.env;
    const env = this.secretMasker.maskEnvironment(sourceEnv, request.allowedEnv ?? []);
    const started = Date.now();

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        workspace: realpathSync(request.cwd),
        rootfs: realpathSync(rootfs!),
        executable: request.command,
        args: [...(request.args ?? [])],
        cgroup_id: `exec-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timeout_ms: timeoutMs,
        memory_bytes: memoryMb * 1024 * 1024,
        cpu_max_us: maxCpuMs * 1000,
        cpu_period_us: 100_000,
        pids_max: 128,
        io_max_read_bps: request.ioReadBps ?? this.policy.ioReadBps ?? null,
        io_max_write_bps: request.ioWriteBps ?? this.policy.ioWriteBps ?? null,
        max_file_descriptors: maxFileDescriptors,
        syscall_profile: this.policy.syscallProfile,
      });

      const child = spawn(helper, [], {
        cwd: request.cwd,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let resourceLimitExceeded = false;
      let terminationReason: ProcessTerminationReason | undefined;
      let settled = false;

      const terminate = (): void => {
        if (child.killed) return;
        child.kill("SIGKILL");
      };

      const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
        if (settled) return;
        const remaining = Math.max(0, maxOutputBytes - outputBytes);
        const text = chunk.toString("utf8", 0, Math.min(chunk.byteLength, remaining));
        if (target === "stdout") stdout += text;
        else stderr += text;
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          resourceLimitExceeded = true;
          terminationReason = "output";
          stderr += "\n[Sandbox output limit exceeded]";
          terminate();
        }
      };

      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", (error) => finish(error));

      const wallTimer = setTimeout(() => {
        timedOut = true;
        resourceLimitExceeded = true;
        terminationReason = "timeout";
        terminate();
      }, timeoutMs + 1_000);

      child.once("close", (code, signal) => {
        finish(undefined, code, signal);
      });

      child.stdin.end(payload);

      const finish = (error?: Error, code: number | null = null, signal: NodeJS.Signals | null = null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(wallTimer);
        if (fenceKey && ownerId) {
          // The fence is process-local; the OS cgroup is the real lifecycle boundary.
          if (fenceKey && ownerId) { /* release below */ }
        }
        if (error) {
          if (fenceKey && ownerId) this.releaseFence(fenceKey, ownerId);
          reject(error);
          return;
        }
        const timedOutByNative = stderr.includes("[KLYN_TIMEOUT]");
        const memoryByNative = stderr.includes("[KLYN_MEMORY]");
        const cpuByNative = stderr.includes("[KLYN_CPU]");
        if (timedOutByNative) { timedOut = true; resourceLimitExceeded = true; terminationReason = "timeout"; }
        if (memoryByNative) { resourceLimitExceeded = true; terminationReason = "memory"; }
        if (cpuByNative) { resourceLimitExceeded = true; terminationReason = "cpu"; }
        const helperFailure = code === 125;
        if (helperFailure) {
          if (fenceKey && ownerId) this.releaseFence(fenceKey, ownerId);
          reject(new Error(`Native sandbox failed: ${stderr || "unknown error"}`));
          return;
        }
        if (fenceKey && ownerId) this.releaseFence(fenceKey, ownerId);
        resolve({
          exitCode: code,
          signal,
          stdout: this.secretMasker.redact(stdout),
          stderr: this.secretMasker.redact(stderr),
          durationMs: Date.now() - started,
          timedOut,
          memoryExceeded: /memory\.events.*oom_kill|memory limit/i.test(stderr),
          resourceLimitExceeded,
          ...(terminationReason === undefined ? {} : { terminationReason }),
        });
      };
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
    if (process.platform !== "linux") throw new Error("Execution sandbox requires Linux");
    if (!isAbsolute(request.command)) throw new Error("Command must be an absolute executable path inside the sandbox rootfs");
    if (!this.policy.allowedCommands.has(request.command)) throw new Error(`Command is not permitted: ${request.command}`);
    if (!request.cwd || !isAbsolute(request.cwd)) throw new Error("cwd must be absolute");
    if (!request.rootfs && !this.policy.rootfs) throw new Error("A dedicated immutable sandbox rootfs is required");
    const helper = this.policy.nativeHelperPath ?? helperDefaultPath();
    if (!existsSync(helper)) throw new Error(`Native sandbox helper not found: ${helper}`);
    const values = [
      request.timeoutMs ?? this.policy.maxTimeoutMs,
      request.memoryMb ?? this.policy.maxMemoryMb,
      request.maxCpuMs ?? this.policy.maxCpuMs,
      request.maxFileDescriptors ?? this.policy.maxFileDescriptors,
      request.maxOutputBytes ?? this.policy.maxOutputBytes,
    ];
    if (values.some((v) => !Number.isSafeInteger(v) || v <= 0)) throw new Error("Sandbox resource limits must be positive integers");
    if (!realpathSync(request.cwd)) throw new Error("Workspace canonicalization failed");
    if (!realpathSync(request.rootfs ?? this.policy.rootfs!)) throw new Error("Rootfs canonicalization failed");
  }
}
