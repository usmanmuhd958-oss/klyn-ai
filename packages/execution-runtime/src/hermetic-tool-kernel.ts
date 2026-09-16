import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  DEFAULT_PROCESS_SANDBOX_POLICY,
  ProcessSandboxManager,
  type ProcessSandboxPolicy,
} from "./process-sandbox-manager.js";
import type {
  AstPatchArgs,
  AstPatchResult,
  BashResult,
  BashToolArgs,
  FileMutationResult,
  FileReadResult,
  FileTreeToolArgs,
  GitResult,
  GitToolArgs,
  HermeticToolCall,
  HermeticToolResult,
  HermeticToolKernelOptions,
  ToolAuditRecord,
  ToolExecutionKernel,
} from "./hermetic-tool-contracts.js";

export class HermeticToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermeticToolError";
  }
}

const sha256Text = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const stableSerialize = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new HermeticToolError("Non-finite number cannot be hashed");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  throw new HermeticToolError(`Unsupported value type for canonical hashing: ${typeof value}`);
};

const hashValue = (value: unknown): string => sha256Text(stableSerialize(value));

const assertSafeRelativePath = (candidate: string): void => {
  if (candidate.length === 0 || isAbsolute(candidate)) {
    throw new HermeticToolError("Tool paths must be non-empty workspace-relative paths");
  }
  const normalized = candidate.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new HermeticToolError(`Path traversal is not permitted: ${candidate}`);
  }
};

const sameWorkspace = (root: string, candidate: string): boolean => {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
};

export class HermeticToolKernel implements ToolExecutionKernel {
  private readonly workspaceRoot: string;
  private readonly processSandbox: ProcessSandboxManager;
  private readonly enableBash: boolean;
  private readonly auditTrail: ToolAuditRecord[] = [];

  constructor(options: HermeticToolKernelOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.enableBash = options.enableBash ?? false;

    const policy: ProcessSandboxPolicy = {
      ...DEFAULT_PROCESS_SANDBOX_POLICY,
      maxTimeoutMs: options.processSandbox?.maxTimeoutMs ?? DEFAULT_PROCESS_SANDBOX_POLICY.maxTimeoutMs,
      maxMemoryMb: options.processSandbox?.maxMemoryMb ?? DEFAULT_PROCESS_SANDBOX_POLICY.maxMemoryMb,
      maxOutputBytes: options.processSandbox?.maxOutputBytes ?? DEFAULT_PROCESS_SANDBOX_POLICY.maxOutputBytes,
      allowedCommands: new Set([...DEFAULT_PROCESS_SANDBOX_POLICY.allowedCommands, "git", "bash"]),
    };

    this.processSandbox = new ProcessSandboxManager(policy);
  }

  async execute(call: HermeticToolCall): Promise<{ result: HermeticToolResult; audit: ToolAuditRecord }> {
    this.validateMetadata(call);
    const requestHash = hashValue(call);
    const result = await this.dispatch(call);
    const previousAuditHash = this.auditTrail.at(-1)?.auditHash ?? null;
    const unsignedAudit = {
      sequence: this.auditTrail.length + 1,
      callId: call.callId,
      agentId: call.agentId,
      intentId: call.intentId,
      tool: call.tool,
      requestHash,
      resultHash: hashValue(result),
      previousAuditHash,
    };
    const audit = Object.freeze({
      ...unsignedAudit,
      auditHash: hashValue(unsignedAudit),
    });
    this.auditTrail.push(audit);
    return { result, audit };
  }

  getAuditTrail(): readonly ToolAuditRecord[] {
    return [...this.auditTrail];
  }

  private validateMetadata(call: HermeticToolCall): void {
    for (const [name, value] of [
      ["callId", call.callId],
      ["agentId", call.agentId],
      ["intentId", call.intentId],
      ["workingDirectory", call.workingDirectory],
    ] as const) {
      if (!value) throw new HermeticToolError(`${name} is required`);
    }
    const workingDirectory = resolve(this.workspaceRoot, call.workingDirectory);
    if (!sameWorkspace(this.workspaceRoot, workingDirectory)) {
      throw new HermeticToolError("workingDirectory escapes workspace root");
    }
  }

  private async dispatch(call: HermeticToolCall): Promise<HermeticToolResult> {
    switch (call.tool) {
      case "file-tree":
        return this.executeFileTree(call.args, call.workingDirectory);
      case "git":
        return this.executeGit(call.args, call.workingDirectory);
      case "bash":
        return this.executeBash(call.args, call.workingDirectory);
      case "ast-patch":
        return this.executeAstPatch(call.args);
      default:
        return this.assertNever(call);
    }
  }

  private async executeFileTree(args: FileTreeToolArgs, workingDirectory: string): Promise<FileReadResult | FileMutationResult> {
    switch (args.operation) {
      case "read": {
        const absolutePath = await this.resolvePath(args.path, workingDirectory, false);
        const content = await readFile(absolutePath, "utf8");
        return { path: this.relativePath(absolutePath), content, sha256: sha256Text(content) };
      }
      case "write": {
        const absolutePath = await this.resolvePath(args.path, workingDirectory, false);
        const current = await this.readOptional(absolutePath);
        this.assertExpectedSha(current, args.expectedSha256, args.path);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, args.content, "utf8");
        return { path: this.relativePath(absolutePath), sha256: sha256Text(args.content) };
      }
      case "delete": {
        const absolutePath = await this.resolvePath(args.path, workingDirectory, false);
        const current = await this.readOptional(absolutePath);
        if (current === null) throw new HermeticToolError(`File does not exist: ${args.path}`);
        this.assertExpectedSha(current, args.expectedSha256, args.path);
        await rm(absolutePath);
        return { path: this.relativePath(absolutePath), sha256: args.expectedSha256 };
      }
      case "mkdir": {
        const absolutePath = await this.resolvePath(args.path, workingDirectory, false);
        await mkdir(absolutePath, { recursive: false });
        return { path: this.relativePath(absolutePath), sha256: sha256Text("directory") };
      }
      case "move": {
        const source = await this.resolvePath(args.from, workingDirectory, true);
        const destination = await this.resolvePath(args.to, workingDirectory, false);
        const current = await this.readOptional(source);
        if (current === null) throw new HermeticToolError(`Source file does not exist: ${args.from}`);
        this.assertExpectedSha(current, args.expectedSha256, args.from);
        if (await this.exists(destination)) throw new HermeticToolError(`Destination already exists: ${args.to}`);
        await mkdir(dirname(destination), { recursive: true });
        await rename(source, destination);
        return { path: this.relativePath(destination), sha256: args.expectedSha256 };
      }
      default:
        return this.assertNever(args);
    }
  }

  private async executeGit(args: GitToolArgs, workingDirectory: string): Promise<GitResult> {
    const cwd = await this.resolveDirectory(workingDirectory);
    switch (args.operation) {
      case "status":
        return this.runGit(["status", "--short", "--branch"], cwd);
      case "diff":
        return this.runGit(["diff", ...(args.staged ? ["--cached"] : [])], cwd);
      case "apply": {
        const patchPath = resolve(this.workspaceRoot, `.klyn-tool-patch-${Date.now()}-${process.pid}.diff`);
        await writeFile(patchPath, args.patch, "utf8");
        try {
          const commandArgs = ["apply", "--whitespace=error", ...(args.checkOnly ? ["--check"] : []), patchPath];
          return await this.runGit(commandArgs, cwd);
        } finally {
          await rm(patchPath, { force: true });
        }
      }
      default:
        return this.assertNever(args);
    }
  }

  private async executeBash(args: BashToolArgs, workingDirectory: string): Promise<BashResult> {
    if (!this.enableBash) {
      throw new HermeticToolError("Bash tool is disabled; enable it only inside an externally sandboxed runtime");
    }
    const cwd = await this.resolveDirectory(workingDirectory);
    const result = await this.processSandbox.execute({
      command: "bash",
      args: ["--noprofile", "--norc", "-c", args.script],
      cwd,
      timeoutMs: args.timeoutMs,
      maxOutputBytes: args.maxOutputBytes,
      fenceKey: `tool-bash:${cwd}`,
      ownerId: "hermetic-tool-kernel",
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
  }

  private async executeAstPatch(args: AstPatchArgs): Promise<AstPatchResult> {
    const absolutePath = await this.resolvePath(args.path, ".", false);
    const current = await this.readOptional(absolutePath);
    if (current === null) throw new HermeticToolError(`File does not exist: ${args.path}`);
    this.assertExpectedSha(current, args.expectedSha256, args.path);

    const replacements = [...args.replacements].sort((left, right) => right.start - left.start);
    let next = current;
    let previousStart = Number.POSITIVE_INFINITY;
    for (const replacement of replacements) {
      if (!Number.isInteger(replacement.start) || !Number.isInteger(replacement.end) || replacement.start < 0 || replacement.end < replacement.start) {
        throw new HermeticToolError("AST patch offsets must be non-negative integer ranges");
      }
      if (replacement.end > current.length || replacement.end > previousStart) {
        throw new HermeticToolError("AST patch replacements overlap or exceed source bounds");
      }
      next = `${next.slice(0, replacement.start)}${replacement.replacement}${next.slice(replacement.end)}`;
      previousStart = replacement.start;
    }

    await writeFile(absolutePath, next, "utf8");
    return {
      path: this.relativePath(absolutePath),
      sha256: sha256Text(next),
      replacementsApplied: replacements.length,
    };
  }

  private async runGit(args: readonly string[], cwd: string): Promise<GitResult> {
    const result = await this.processSandbox.execute({
      command: "git",
      args: ["-C", cwd, ...args],
      cwd,
      fenceKey: `tool-git:${cwd}`,
      ownerId: "hermetic-tool-kernel",
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? -1,
    };
  }

  private async resolveDirectory(workingDirectory: string): Promise<string> {
    const directory = await this.resolvePath(".", workingDirectory, true);
    const info = await stat(directory);
    if (!info.isDirectory()) throw new HermeticToolError(`Not a directory: ${workingDirectory}`);
    return directory;
  }

  private async resolvePath(candidate: string, workingDirectory: string, existingRequired: boolean): Promise<string> {
    assertSafeRelativePath(candidate === "." ? "workspace" : candidate);
    const base = resolve(this.workspaceRoot, workingDirectory);
    if (!sameWorkspace(this.workspaceRoot, base)) throw new HermeticToolError("Working directory escapes workspace root");
    const absolutePath = resolve(base, candidate === "." ? "." : candidate);
    if (!sameWorkspace(this.workspaceRoot, absolutePath)) throw new HermeticToolError(`Path escapes workspace root: ${candidate}`);

    const realRoot = await realpath(this.workspaceRoot);
    if (existingRequired) {
      const real = await realpath(absolutePath);
      if (!sameWorkspace(realRoot, real)) throw new HermeticToolError(`Symlink escapes workspace root: ${candidate}`);
      return real;
    }

    const parent = await realpath(dirname(absolutePath)).catch(() => null);
    if (parent !== null && !sameWorkspace(realRoot, parent)) {
      throw new HermeticToolError(`Symlink escapes workspace root: ${candidate}`);
    }
    return absolutePath;
  }

  private relativePath(absolutePath: string): string {
    return relative(this.workspaceRoot, absolutePath).replaceAll("\\", "/") || ".";
  }

  private async readOptional(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return false;
      throw error;
    }
  }

  private assertExpectedSha(current: string | null, expectedSha: string | null, path: string): void {
    if (expectedSha === null) {
      if (current !== null) throw new HermeticToolError(`Create-only write rejected because ${path} already exists`);
      return;
    }
    if (current === null) throw new HermeticToolError(`Expected existing file not found: ${path}`);
    const actual = sha256Text(current);
    if (actual !== expectedSha) {
      throw new HermeticToolError(`Stale file revision for ${path}: expected ${expectedSha}, observed ${actual}`);
    }
  }

  private assertNever(value: never): never {
    throw new HermeticToolError(`Unsupported tool variant: ${JSON.stringify(value)}`);
  }
}
