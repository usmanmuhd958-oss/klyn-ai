// =============================================================================
// KLYN AI OS — 1.brain — Multi-Modal Architectural Knowledge Engine (Phase 8)
// File: 1.brain/enterprise_knowledge_graph.ts
//
// Phase 8 capability #2. An in-memory, lock-free knowledge engine that FUSES
// three previously-disconnected modalities into one traceable graph:
//
//   - git commit history      (historical rationale: who changed what, why)
//   - spec definitions        (Phase 4 spec_compiler CompiledSpec artifacts)
//   - AST symbols             (Phase 3 structural context symbol records)
//
// Intent tracing: agents can query the historical rationale and spec intent
// behind ANY backend module or type declaration —
//
//   graph.ingestCommit(commit)                    — record a commit + its files
//   graph.ingestSpec(compiled)                    — register a compiled spec
//   graph.ingestSymbols(file, symbols)            — link AST symbols to files
//   graph.traceIntent('Project')                  — full intent trace: files,
//                                                    symbols, spec, commits
//   graph.queryRationale('src/api/project.ts')    — the WHY behind a module
//
// Lock-free by construction (plain Map mutations on the single-threaded event
// loop), bounded memory (LRU-ish eviction on commit and symbol tables), and
// deterministic ordering in every result set.
// =============================================================================
import type { CompiledSpec } from './spec_compiler.js';

export interface CommitRecord {
  hash: string;
  message: string;
  /** Repo-relative files touched by the commit. */
  files: string[];
  timestamp: number;
  author?: string;
}

export interface SpecKnowledge {
  /** Entity name in PascalCase (also a symbol in the AST index). */
  entity: string;
  table: string;
  endpoints: string[];
  fields: string[];
  deterministicKey: string;
  astNodeCount: number;
  ingestedAt: number;
}

export interface IntentTrace {
  target: string;
  kind: 'symbol' | 'file' | 'unknown';
  /** Files related to the target (declaring, or the file itself). */
  files: string[];
  /** Symbols related to the target. */
  symbols: string[];
  /** Spec definition backing the target (when one exists). */
  spec: SpecKnowledge | null;
  /** Commit history touching the related files, newest first. */
  commits: CommitRecord[];
  /** Synthesized rationale statements (deterministic, human-readable). */
  rationale: string[];
}

export interface KnowledgeStats {
  commits: number;
  specs: number;
  symbols: number;
  files: number;
  evictedCommits: number;
  evictedSymbols: number;
}

export interface KnowledgeGraphOptions {
  /** Bounded commit history (default 4_096 — rollback of rationale depth). */
  maxCommits?: number;
  /** Bounded symbol→file index entries (default 32_768). */
  maxSymbolEntries?: number;
}

const MIN_KEYWORD_LENGTH = 4;
const KEYWORD_STOPWORDS = new Set([
  'with', 'from', 'this', 'that', 'when', 'which', 'what', 'where', 'merge',
  'pull', 'push', 'into', 'onto', 'than', 'then', 'they', 'them', 'have',
  'been', 'were', 'will', 'would', 'could', 'should', 'after', 'before',
]);

/** Extract deterministic keywords from a commit message (rationale atoms). */
export function extractCommitKeywords(message: string): string[] {
  const tokens = message.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const token of tokens) {
    if (token.length >= MIN_KEYWORD_LENGTH && !KEYWORD_STOPWORDS.has(token)) out.add(token);
  }
  return Array.from(out).sort();
}

export class EnterpriseKnowledgeGraph {
  private commits = new Map<string, CommitRecord>();
  private commitKeywords = new Map<string, string[]>();
  private commitsByFile = new Map<string, Set<string>>();
  private specs = new Map<string, SpecKnowledge>();
  private symbolFiles = new Map<string, Set<string>>();
  private fileSymbols = new Map<string, Set<string>>();
  private evictedCommits = 0;
  private evictedSymbols = 0;
  private readonly maxCommits: number;
  private readonly maxSymbolEntries: number;

  constructor(options: KnowledgeGraphOptions = {}) {
    this.maxCommits = options.maxCommits ?? 4_096;
    this.maxSymbolEntries = options.maxSymbolEntries ?? 32_768;
  }

  // -------------------------------------------------------------------------
  // INGESTION
  // -------------------------------------------------------------------------

  /** Record a git commit and index it against every file it touched. */
  ingestCommit(commit: CommitRecord): void {
    if (this.commits.has(commit.hash)) return;
    // Bound memory: evict the oldest commit (insertion order = oldest first).
    if (this.commits.size >= this.maxCommits) {
      const oldest = this.commits.keys().next().value;
      if (oldest !== undefined) this.removeCommit(oldest);
    }
    this.commits.set(commit.hash, commit);
    this.commitKeywords.set(commit.hash, extractCommitKeywords(commit.message));
    for (const file of commit.files) {
      const set = this.commitsByFile.get(file) ?? new Set<string>();
      set.add(commit.hash);
      this.commitsByFile.set(file, set);
    }
  }

  /** Register a Phase 4 compiled spec; its entity becomes a queryable symbol. */
  ingestSpec(spec: CompiledSpec): void {
    // Field names are recovered deterministically from the spec's own
    // deterministicKey (the intent fingerprint), never guessed.
    let fields: string[] = [];
    try {
      const key = JSON.parse(spec.deterministicKey) as { fields?: Array<[string, ...unknown[]]> };
      fields = (key.fields ?? []).map((f) => f[0]);
    } catch {
      // unparseable key — empty field list, spec itself is still registered
    }
    this.specs.set(spec.entity, {
      entity: spec.entity,
      table: spec.table,
      endpoints: spec.endpoints.map((e) => `${e.method} ${e.path}`),
      fields,
      deterministicKey: spec.deterministicKey,
      astNodeCount: spec.astNodeCount,
      ingestedAt: Date.now(),
    });
  }

  /** Link AST symbols to a file (accepts SymbolRecord names or raw strings). */
  ingestSymbols(file: string, symbols: Array<string | { name: string }>): void {
    for (const entry of symbols) {
      const name = typeof entry === 'string' ? entry : entry.name;
      if (!name) continue;
      const files = this.symbolFiles.get(name) ?? new Set<string>();
      if (files.size === 0 && this.symbolFiles.size >= this.maxSymbolEntries) {
        // Bound memory: evict the oldest symbol entry.
        const oldest = this.symbolFiles.keys().next().value;
        if (oldest !== undefined) {
          for (const f of this.symbolFiles.get(oldest) ?? []) this.fileSymbols.get(f)?.delete(oldest);
          this.symbolFiles.delete(oldest);
          this.evictedSymbols++;
        }
      }
      if (files.has(file)) continue;
      files.add(file);
      this.symbolFiles.set(name, files);
      const symbolsInFile = this.fileSymbols.get(file) ?? new Set<string>();
      symbolsInFile.add(name);
      this.fileSymbols.set(file, symbolsInFile);
    }
  }

  // -------------------------------------------------------------------------
  // INTENT TRACING + RATIONALE QUERIES
  // -------------------------------------------------------------------------

  /**
   * Full multi-modal trace behind a symbol or module: resolve the target,
   * gather its files and symbols, attach the backing spec definition, and
   * surface the commit history that explains WHY it looks the way it does.
   */
  traceIntent(target: string): IntentTrace {
    const files: string[] = [];
    const symbols: string[] = [];
    let kind: IntentTrace['kind'] = 'unknown';

    if (this.symbolFiles.has(target)) {
      kind = 'symbol';
      symbols.push(target);
      files.push(...Array.from(this.symbolFiles.get(target) ?? []));
    } else if (this.fileSymbols.has(target)) {
      kind = 'file';
      files.push(target);
      symbols.push(...Array.from(this.fileSymbols.get(target) ?? []));
    } else {
      // Fragment fallback over symbols.
      const lower = target.toLowerCase();
      const found = new Set<string>();
      for (const [symbol, declFiles] of this.symbolFiles) {
        if (symbol.toLowerCase().includes(lower)) {
          found.add(symbol);
          for (const f of declFiles) files.push(f);
        }
      }
      if (found.size > 0) {
        kind = 'symbol';
        symbols.push(...found);
      }
    }

    const uniqueFiles = Array.from(new Set(files)).sort();
    const uniqueSymbols = Array.from(new Set(symbols)).sort();

    // Spec intent: the target (or any of its symbols) names a spec entity.
    let spec: SpecKnowledge | null = null;
    for (const candidate of [target, ...uniqueSymbols]) {
      const hit = this.specs.get(candidate);
      if (hit) {
        spec = hit;
        break;
      }
    }

    const commits = this.commitsForFiles(uniqueFiles);
    const rationale = this.buildRationale(commits, spec, target);

    return {
      target,
      kind,
      files: uniqueFiles,
      symbols: uniqueSymbols,
      spec,
      commits,
      rationale,
    };
  }

  /** The WHY behind a module or type: commit messages + spec intent. */
  queryRationale(target: string): string[] {
    return this.traceIntent(target).rationale;
  }

  /** Commit history touching a set of files, newest first. */
  commitsForFiles(files: string[]): CommitRecord[] {
    const seen = new Set<string>();
    const out: CommitRecord[] = [];
    for (const file of files) {
      for (const hash of this.commitsByFile.get(file) ?? []) {
        if (seen.has(hash)) continue;
        seen.add(hash);
        const commit = this.commits.get(hash);
        if (commit) out.push(commit);
      }
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Spec backing an entity name (null when not compiled). */
  entitySpec(entity: string): SpecKnowledge | null {
    return this.specs.get(entity) ?? null;
  }

  /** Files declaring a symbol (headless lookup). */
  filesForSymbol(symbol: string): string[] {
    return Array.from(this.symbolFiles.get(symbol) ?? []).sort();
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  getStats(): KnowledgeStats {
    let symbolEntries = 0;
    for (const files of this.symbolFiles.values()) symbolEntries += files.size;
    return {
      commits: this.commits.size,
      specs: this.specs.size,
      symbols: this.symbolFiles.size,
      files: this.fileSymbols.size,
      evictedCommits: this.evictedCommits,
      evictedSymbols: this.evictedSymbols,
    };
  }

  /** Drop all knowledge (tests, memory pressure, cold start). */
  reset(): void {
    this.commits.clear();
    this.commitKeywords.clear();
    this.commitsByFile.clear();
    this.specs.clear();
    this.symbolFiles.clear();
    this.fileSymbols.clear();
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private removeCommit(hash: string): void {
    const commit = this.commits.get(hash);
    if (!commit) return;
    this.commits.delete(hash);
    this.commitKeywords.delete(hash);
    for (const file of commit.files) {
      const set = this.commitsByFile.get(file);
      set?.delete(hash);
      if (set && set.size === 0) this.commitsByFile.delete(file);
    }
    this.evictedCommits++;
  }

  private buildRationale(commits: CommitRecord[], spec: SpecKnowledge | null, target: string): string[] {
    const out: string[] = [];
    if (spec) {
      out.push(`"${target}" is defined by the compiled "${spec.entity}" spec (table "${spec.table}") with ${spec.endpoints.length} endpoint(s) and ${spec.fields.length} field shape(s)`);
    }
    for (const commit of commits) {
      const author = commit.author ? ` (${commit.author})` : '';
      out.push(`commit ${commit.hash.slice(0, 8)}${author} @ ${new Date(commit.timestamp).toISOString()}: ${commit.message}`);
    }
    if (out.length === 0) {
      out.push(`no spec or commit rationale recorded for "${target}"`);
    }
    return out;
  }
}

/** Canonical singleton (mirrors the other engine singletons). */
export const enterpriseKnowledgeGraph = new EnterpriseKnowledgeGraph();

export default EnterpriseKnowledgeGraph;
