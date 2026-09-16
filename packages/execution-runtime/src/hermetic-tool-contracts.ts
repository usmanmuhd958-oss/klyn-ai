export type ToolName = "file-tree" | "git" | "bash" | "ast-patch";

export interface ToolCallMetadata {
  readonly callId: string;
  readonly agentId: string;
  readonly intentId: string;
  readonly workingDirectory: string;
}

export interface FileReadArgs {
  readonly operation: "read";
  readonly path: string;
}

export interface FileWriteArgs {
  readonly operation: "write";
  readonly path: string;
  readonly content: string;
  readonly expectedSha256: string | null;
}

export interface FileDeleteArgs {
  readonly operation: "delete";
  readonly path: string;
  readonly expectedSha256: string;
}

export interface FileMkdirArgs {
  readonly operation: "mkdir";
  readonly path: string;
}

export interface FileMoveArgs {
  readonly operation: "move";
  readonly from: string;
  readonly to: string;
  readonly expectedSha256: string;
}

export type FileTreeToolArgs =
  | FileReadArgs
  | FileWriteArgs
  | FileDeleteArgs
  | FileMkdirArgs
  | FileMoveArgs;

export interface GitStatusArgs {
  readonly operation: "status";
}

export interface GitDiffArgs {
  readonly operation: "diff";
  readonly staged: boolean;
}

export interface GitApplyArgs {
  readonly operation: "apply";
  readonly patch: string;
  readonly checkOnly: boolean;
}

export type GitToolArgs = GitStatusArgs | GitDiffArgs | GitApplyArgs;

export interface BashToolArgs {
  readonly operation: "execute";
  readonly script: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface AstPatchReplacement {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

export interface AstPatchArgs {
  readonly operation: "apply-replacements";
  readonly path: string;
  readonly expectedSha256: string;
  readonly replacements: readonly AstPatchReplacement[];
}

export interface ToolCall<TName extends ToolName, TArgs> extends ToolCallMetadata {
  readonly tool: TName;
  readonly args: TArgs;
}

export type HermeticToolCall =
  | ToolCall<"file-tree", FileTreeToolArgs>
  | ToolCall<"git", GitToolArgs>
  | ToolCall<"bash", BashToolArgs>
  | ToolCall<"ast-patch", AstPatchArgs>;

export interface FileReadResult {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
}

export interface FileMutationResult {
  readonly path: string;
  readonly sha256: string;
}

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface BashResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

export interface AstPatchResult {
  readonly path: string;
  readonly sha256: string;
  readonly replacementsApplied: number;
}

export type HermeticToolResult =
  | FileReadResult
  | FileMutationResult
  | GitResult
  | BashResult
  | AstPatchResult;

export interface ToolAuditRecord {
  readonly sequence: number;
  readonly callId: string;
  readonly agentId: string;
  readonly intentId: string;
  readonly tool: ToolName;
  readonly requestHash: string;
  readonly resultHash: string;
  readonly previousAuditHash: string | null;
  readonly auditHash: string;
}

export interface HermeticToolKernelOptions {
  readonly workspaceRoot: string;
  readonly processSandbox?: ProcessSandboxPolicyLike;
  readonly enableBash?: boolean;
}

export interface ProcessSandboxPolicyLike {
  readonly maxTimeoutMs?: number;
  readonly maxMemoryMb?: number;
  readonly maxOutputBytes?: number;
}

export interface ToolExecutionKernel {
  execute(call: HermeticToolCall): Promise<{ result: HermeticToolResult; audit: ToolAuditRecord }>;
  getAuditTrail(): readonly ToolAuditRecord[];
}
