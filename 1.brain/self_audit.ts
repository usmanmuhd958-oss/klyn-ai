// =============================================================================
// KLYN AI OS — 1.brain — Self-Audit Scanner (Phase 10)
// File: 1.brain/self_audit.ts
//
// Phase 10 capability #1. The first half of SELF-HOSTING: Klyn turns its own
// source tree into the first-class target of its closed-loop epoch engine.
// The scanner is a deterministic, headless static analyzer over the OS's own
// code — no DOM, no UI, no external deps:
//
//   const scanner = new SelfAuditScanner();
//   const report = await scanner.scan('/path/to/klyn-ai-os');
//   report.findings  — ranked by severity (high → medium → low)
//   report.byKind    — per-detector counts
//
// Detectors (all line-oriented, deterministic, O(file)):
//   todo_debt          — TODO/FIXME/HACK comment markers            (low, auto)
//   debug_log          — console.log/debug in library code          (med, auto)
//   sync_blocking_io   — readFileSync/writeFileSync/... in source   (high)
//   unsafe_eval        — eval( / new Function(                      (high)
//   any_typed          — `: any` / `as any` type escapes            (med)
//   overlong_function  — function spans > threshold lines           (med)
//
// Only `todo_debt` and `debug_log` are AUTO-FIXABLE today (safe, syntax-
// preserving repairs the SelfHostingLoop can synthesize deterministically).
// The rest are flagged and escalated to the operator — the OS never mutates
// a file for a manual finding unless explicitly forced.
//
// Scanning is async and non-blocking, skips vendored/binary trees, and caps
// file size so a pathological blob cannot blow the heap.
// =============================================================================
import { readdir } from 'node:fs/promises';
import { openSync, fstatSync, closeSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type SelfAuditKind =
  | 'todo_debt'
  | 'debug_log'
  | 'sync_blocking_io'
  | 'unsafe_eval'
  | 'any_typed'
  | 'overlong_function';

export interface SelfAuditFinding {
  /** Stable id: `${relFile}:${kind}:${line}` — used by the /v1/self/evolve API. */
  id: string;
  /** Absolute path of the file. */
  file: string;
  /** Repo-relative path (forward slashes) — the graph/guard key. */
  relFile: string;
  /** 1-based line of the finding. */
  line: number;
  kind: SelfAuditKind;
  severity: 'low' | 'medium' | 'high';
  detail: string;
  /** True when the SelfHostingLoop may auto-repair this finding. */
  autoFixable: boolean;
  at: number;
}

export interface SelfAuditReport {
  findings: SelfAuditFinding[];
  total: number;
  autoFixable: number;
  byKind: Record<SelfAuditKind, number>;
  scannedFiles: number;
  latencyMs: number;
}

export interface SelfAuditOptions {
  /** Directories skipped at any depth (default: vendored/binary trees). */
  skipDirs?: string[];
  /** Files larger than this are skipped (default 256 KiB). */
  maxFileBytes?: number;
  /** Function span threshold for overlong_function (default 60 lines). */
  overlongThresholdLines?: number;
  /** Detector subset to run (default: all). */
  kinds?: SelfAuditKind[];
}

// -----------------------------------------------------------------------------
// DEFAULTS + DETECTOR PATTERNS
// -----------------------------------------------------------------------------

const DEFAULT_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', 'genesis', '.klyn_selfhost', '.klyn_runtime', 'vault_data', 'coverage']);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_OVERLONG_LINES = 60;

const AUTO_FIXABLE = new Set<SelfAuditKind>(['todo_debt', 'debug_log']);
const SEVERITY: Record<SelfAuditKind, SelfAuditFinding['severity']> = {
  todo_debt: 'low',
  debug_log: 'medium',
  sync_blocking_io: 'high',
  unsafe_eval: 'high',
  any_typed: 'medium',
  overlong_function: 'medium',
};

const SYNC_FS_RE = /\b(?:readFileSync|writeFileSync|appendFileSync|existsSync|readdirSync|statSync|mkdirSync|rmSync|cpSync|unlinkSync|readFileSync|createWriteStream)\s*\(/;
const EVAL_RE = /\beval\s*\(|\bnew Function\s*\(/;
const TODO_RE = /\/\/\s*(?:TODO|FIXME|HACK)\b/;
const DEBUG_LOG_RE = /console\.(?:log|debug)\s*\(/;
const ANY_RE = /(?::\s*any\b|\bas\s+any\b|<any>)/;
const FN_DECL_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/;
const ARROW_FN_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/;

// -----------------------------------------------------------------------------
// SCANNER
// -----------------------------------------------------------------------------

export class SelfAuditScanner {
  private readonly skipDirs: Set<string>;
  private readonly maxFileBytes: number;
  private readonly overlongThresholdLines: number;
  private readonly kinds: Set<SelfAuditKind>;

  constructor(options: SelfAuditOptions = {}) {
    this.skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.overlongThresholdLines = options.overlongThresholdLines ?? DEFAULT_OVERLONG_LINES;
    this.kinds = new Set(options.kinds ?? (Object.keys(SEVERITY) as SelfAuditKind[]));
  }

  /** Scan a source tree and return ranked findings (highest severity first,
   *  then by file/line for determinism). */
  async scan(repoRoot: string): Promise<SelfAuditReport> {
    const t0 = performance.now();
    const findings: SelfAuditFinding[] = [];
    let scannedFiles = 0;

    await this.walk(repoRoot, repoRoot, (relFile: string, absFile: string) => {
      scannedFiles++;
      findings.push(...this.scanFile(absFile, relFile));
    });

    findings.sort((a, b) => {
      const sev = { high: 3, medium: 2, low: 1 } as const;
      if (sev[a.severity] !== sev[b.severity]) return sev[b.severity] - sev[a.severity];
      if (a.relFile !== b.relFile) return a.relFile < b.relFile ? -1 : 1;
      return a.line - b.line;
    });

    const byKind = {
      todo_debt: 0,
      debug_log: 0,
      sync_blocking_io: 0,
      unsafe_eval: 0,
      any_typed: 0,
      overlong_function: 0,
    } as Record<SelfAuditKind, number>;
    for (const f of findings) byKind[f.kind]++;

    return {
      findings,
      total: findings.length,
      autoFixable: findings.filter((f) => f.autoFixable).length,
      byKind,
      scannedFiles,
      latencyMs: performance.now() - t0,
    };
  }

  // -------------------------------------------------------------------------
  // TREE WALK (async, non-blocking, bounded)
  // -------------------------------------------------------------------------

  private async walk(root: string, dir: string, onFile: (relFile: string, absFile: string) => void): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir → skip silently (headless scanner never throws)
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (this.skipDirs.has(entry.name)) continue;
        await this.walk(root, join(dir, entry.name), onFile);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTS.has(extname(entry.name))) continue;
      const abs = join(dir, entry.name);
      const rel = abs.slice(root.length + 1).split('\\').join('/');
      onFile(rel, abs);
    }
  }

  // -------------------------------------------------------------------------
  // PER-FILE DETECTORS
  // -------------------------------------------------------------------------

  private scanFile(absFile: string, relFile: string): SelfAuditFinding[] {
    let content: string;
    try {
      // The scanner uses a single bounded sync read per file (capped by
      // maxFileBytes) so the tree pass stays simple; a file over the cap is
      // skipped entirely. If the OS ever audits its own tree, this detector
      // correctly flags this very call as sync_blocking_io debt.
      const fd = openSync(absFile, 'r');
      const stat = fstatSync(fd);
      closeSync(fd);
      if (stat.size > this.maxFileBytes) return [];
      content = readFileSync(absFile, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.split('\n');
    const out: SelfAuditFinding[] = [];
    const at = Date.now();
    const push = (line: number, kind: SelfAuditKind, detail: string) => {
      out.push({
        id: `${relFile}:${kind}:${line}`,
        file: absFile,
        relFile,
        line,
        kind,
        severity: SEVERITY[kind],
        detail,
        autoFixable: AUTO_FIXABLE.has(kind),
        at,
      });
    };

    // Line-oriented detectors.
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (this.kinds.has('todo_debt') && TODO_RE.test(text)) {
        push(i + 1, 'todo_debt', `debt marker: ${text.trim().slice(0, 72)}`);
      }
      if (this.kinds.has('debug_log') && DEBUG_LOG_RE.test(text)) {
        push(i + 1, 'debug_log', `console output in library code: ${text.trim().slice(0, 72)}`);
      }
      if (this.kinds.has('sync_blocking_io') && SYNC_FS_RE.test(text)) {
        push(i + 1, 'sync_blocking_io', `blocking synchronous file I/O: ${text.trim().slice(0, 72)}`);
      }
      if (this.kinds.has('unsafe_eval') && EVAL_RE.test(text)) {
        push(i + 1, 'unsafe_eval', `dynamic code execution: ${text.trim().slice(0, 72)}`);
      }
      if (this.kinds.has('any_typed') && ANY_RE.test(text)) {
        push(i + 1, 'any_typed', `untyped escape: ${text.trim().slice(0, 72)}`);
      }
    }

    // Function-span detector (brace counting; deterministic).
    if (this.kinds.has('overlong_function')) {
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        const isFn = FN_DECL_RE.test(text) || ARROW_FN_RE.test(text);
        if (!isFn) continue;
        const span = functionSpan(lines, i);
        if (span > this.overlongThresholdLines) {
          push(i + 1, 'overlong_function', `function spans ${span} lines (threshold ${this.overlongThresholdLines})`);
        }
      }
    }

    return out;
  }
}

/** Count lines from `start` until braces balance (approximate but stable for
 *  well-formed code; string literals containing braces are a known lint
 *  limitation, not a correctness hazard for gating). */
function functionSpan(lines: string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let k = start; k < lines.length; k++) {
    const line = lines[k];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
        if (opened && depth === 0) return k - start + 1;
      }
    }
  }
  return lines.length - start;
}

export default SelfAuditScanner;
