// =============================================================================
// KLYN AI OS — 1.brain — AST-Driven Structural Context Engine (Phase 3)
// File: 1.brain/structural_context.ts
//
// Surpasses raw chunk/vector retrieval: agents query for SYMBOLS and get back
// exact semantic subgraphs — the files that declare a symbol, the files that
// CALL it, and the files that transitively import from it — instead of
// arbitrary text slices ranked by cosine similarity.
//
//   engine.refresh(rootPath)          // full ingest (delegates to IndexStore)
//   engine.applyDelta(delta)          // incremental invalidation hook (deltas)
//   engine.onFileWrite(rel, content)  // incremental invalidation hook (writes)
//   engine.resolveSemanticGraph(q)    // <50ms symbol-level context assembly
//   engine.getCallers('foo')          // reverse call lookups
//
// The call graph is cached in memory per file and invalidated incrementally:
// a delta marks exactly which files changed, so only those files' call edges
// are dropped and rebuilt — never a full re-scan.
// =============================================================================
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IndexStore, indexStore, type IndexDelta } from '../src/indexer/index-store.js';
import type { SymbolRecord } from '../src/indexer/symbols.js';

export interface CallEdge {
  /** Repo-relative file that contains the call site. */
  from: string;
  /** Symbol name being called (resolved against the symbol index). */
  callee: string;
  /** Caller symbol name when the call site sits inside a declared symbol,
   *  or 'top' for module-level call sites. */
  caller: string;
  line: number;
}

export interface SemanticGraphNode {
  file: string;
  symbols: SymbolRecord[];
}

export interface SemanticSubgraph {
  query: string;
  /** Candidate symbols the query resolved to (matching the index). */
  symbols: string[];
  /** Nodes: files that declare matched symbols ∪ their dependents ∪ callers. */
  nodes: SemanticGraphNode[];
  /** Symbol call edges (caller file → callee symbol). */
  callEdges: CallEdge[];
  /** Reverse-import closure edges: file → transitively importing files. */
  importEdges: Array<{ from: string; to: string }>;
  /** Total context size in characters (for token budgeting). */
  totalChars: number;
  latencyMs: number;
}

export interface StructuralStats {
  files: number;
  symbols: number;
  callSites: number;
  filesCached: number;
  lastDeltaChanged: boolean;
}

// Keywords that look like call sites but are language control flow.
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'new',
  'typeof', 'instanceof', 'export', 'import', 'delete', 'throw', 'await',
  'yield', 'do', 'else', 'case', 'default', 'void', 'in', 'of', 'extends',
  'implements', 'super', 'this', 'require',
]);

const SYMBOL_QUERY_PATTERNS: RegExp[] = [
  /\b([A-Z][a-zA-Z0-9_]+)\b/g,
  /\b([a-z][a-zA-Z0-9_]+)\s*\(/g,
];

const MAX_QUERY_SYMBOLS = 12;
const MAX_SUBGRAPH_FILES = 64;

/**
 * Extracts plausible symbol identifiers from a natural-language query
 * (PascalCase tokens + identifiers followed by an open paren).
 */
export function extractSymbolCandidates(query: string): string[] {
  const found = new Set<string>();
  for (const pattern of SYMBOL_QUERY_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(query)) !== null) {
      const symbol = match[1];
      if (symbol.length > 2 && !CONTROL_KEYWORDS.has(symbol)) found.add(symbol);
    }
  }
  return Array.from(found).slice(0, MAX_QUERY_SYMBOLS);
}

// Common English/CLI words that are never symbol names — dropped when the
// query has no explicit symbol-shaped tokens so fragment matching stays clean.
const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'when', 'which', 'what',
  'where', 'how', 'why', 'show', 'get', 'find', 'list', 'search', 'display',
  'file', 'files', 'code', 'query', 'using', 'use', 'all', 'any', 'not', 'new',
  'add', 'create', 'delete', 'update', 'change', 'fix', 'refactor', 'analyze',
  'explain', 'impact', 'dependency', 'dependencies', 'symbol', 'symbols',
  'function', 'class', 'route', 'api', 'about', 'with', 'into', 'make', 'want',
  'need', 'help', 'please', 'like', 'such', 'would', 'could', 'should', 'than',
]);

/** Fallback tokens when the query has no symbol-shaped identifiers: plain
 *  words ≥ 4 chars, minus stopwords. */
export function extractQueryWords(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? [];
  const out = new Set<string>();
  for (const word of words) {
    if (!QUERY_STOPWORDS.has(word)) out.add(word);
  }
  return Array.from(out).slice(0, MAX_QUERY_SYMBOLS);
}

/** Isolated (no control-flow) identifier followed by `(` — a call candidate. */
const CALL_SITE_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;

/** Lines that declare a symbol rather than call one (parameter lists). */
const DECLARATION_LINE_RE =
  /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:default\s+)?(?:function|class|interface|type|enum)\b|^(?:export\s+)?(?:const|let|var)\b/;

export class StructuralContextEngine {
  private callsByFile = new Map<string, Map<string, CallEdge[]>>();
  private callersByName = new Map<string, Set<string>>();
  private fileCache = new Map<string, string>();
  private lastDeltaChanged = false;

  constructor(private index: IndexStore) {}

  // -------------------------------------------------------------------------
  // INGESTION + INCREMENTAL INVALIDATION HOOKS
  // -------------------------------------------------------------------------

  /** Full refresh: delegate to the IndexStore, then rebuild call edges for
   *  every file the delta touched. */
  async refresh(rootPath: string): Promise<IndexDelta> {
    const delta = await this.index.refresh(rootPath);
    await this.applyDelta(delta, rootPath);
    return delta;
  }

  /** Incremental invalidation: drop + rebuild call edges ONLY for the files
   *  the delta marks. Nothing else is touched — no full re-scan. */
  async applyDelta(delta: IndexDelta, rootPath: string = process.cwd()): Promise<void> {
    this.lastDeltaChanged = delta.changed;
    for (const rel of delta.removed) this.dropFile(rel);
    for (const rel of delta.modified) {
      this.dropFile(rel);
      await this.ingestFile(rel, rootPath);
    }
    for (const rel of delta.added) await this.ingestFile(rel, rootPath);
  }

  /** Incremental invalidation hook for a single file write: update the
   *  content cache and rebuild that file's call edges in place. */
  async onFileWrite(rel: string, content: string, rootPath: string = process.cwd()): Promise<void> {
    this.fileCache.set(rel, content);
    this.dropFile(rel);
    await this.ingestFile(rel, rootPath, content);
  }

  /** Explicit invalidation: forget a file's cached call edges. */
  invalidateFile(rel: string): void {
    this.dropFile(rel);
  }

  // -------------------------------------------------------------------------
  // SEMANTIC SUBGRAPH RESOLUTION (the Phase 3 retrieval surface)
  // -------------------------------------------------------------------------

  /** Resolve a query to its semantic subgraph in memory — target <50ms. */
  resolveSemanticGraph(query: string): SemanticSubgraph {
    const t0 = performance.now();
    const candidates = extractSymbolCandidates(query);
    const tokens = candidates.length > 0 ? candidates : extractQueryWords(query);

    // 1) Match tokens against the symbol index: exact name first, then
    //    case-insensitive fragment match (so 'compute' resolves even without
    //    a call-site-shaped token).
    const matched = new Set<string>();
    const locations = new Map<string, string[]>();
    for (const token of tokens) {
      const exact = this.index.getSymbolLocations(token);
      if (exact.length > 0) {
        matched.add(token);
        locations.set(token, exact);
        continue;
      }
      const frag = this.index.querySymbolsByFragment(token, 4);
      if (frag.length > 0) {
        matched.add(token);
        locations.set(
          token,
          Array.from(new Set(frag.map((s) => s.file))).sort()
        );
      }
    }
    const matchedSet = new Set(matched);

    // 2) Node set: declaring files + their transitive dependents + callers.
    const nodeFiles = new Set<string>();
    const nodeSymbols = new Map<string, SymbolRecord[]>();
    for (const symbol of matched) {
      for (const rel of locations.get(symbol) ?? []) {
        nodeFiles.add(rel);
        const records = this.index.getFileSymbols(rel);
        nodeSymbols.set(rel, records);
        for (const dep of this.index.getAffectedFiles(rel)) {
          if (nodeFiles.size >= MAX_SUBGRAPH_FILES) break;
          nodeFiles.add(dep);
          if (!nodeSymbols.has(dep)) nodeSymbols.set(dep, this.index.getFileSymbols(dep));
        }
      }
      for (const rel of this.getCallers(symbol)) {
        if (nodeFiles.size >= MAX_SUBGRAPH_FILES) break;
        nodeFiles.add(rel);
        if (!nodeSymbols.has(rel)) nodeSymbols.set(rel, this.index.getFileSymbols(rel));
      }
    }

    // 3) Call edges restricted to the node set (cheap map lookups).
    const callEdges: CallEdge[] = [];
    for (const rel of nodeFiles) {
      const edges = this.callsByFile.get(rel);
      if (!edges) continue;
      for (const list of edges.values()) {
        for (const edge of list) {
          if (matchedSet.has(edge.callee) || nodeFiles.has(edge.callee)) callEdges.push(edge);
        }
      }
    }

    // 4) Reverse-import edges within the node set.
    const importEdges: Array<{ from: string; to: string }> = [];
    for (const rel of nodeFiles) {
      for (const dep of this.index.getAffectedFiles(rel)) {
        if (nodeFiles.has(dep) && dep !== rel) importEdges.push({ from: dep, to: rel });
      }
    }

    let totalChars = 0;
    for (const rel of nodeFiles) {
      totalChars += this.fileCache.get(rel)?.length ?? 0;
    }

    const nodes: SemanticGraphNode[] = Array.from(nodeFiles)
      .sort()
      .map((file) => ({ file, symbols: nodeSymbols.get(file) ?? [] }));

    return {
      query,
      symbols: Array.from(matched),
      nodes,
      callEdges,
      importEdges,
      totalChars,
      latencyMs: performance.now() - t0,
    };
  }

  /** Files (repo-relative) containing a call site of `symbolName`. */
  getCallers(symbolName: string): string[] {
    const files = this.callersByName.get(symbolName);
    return files ? Array.from(files).sort() : [];
  }

  /** Call edges originating from a file (for debug/observability). */
  getFileCallEdges(rel: string): CallEdge[] {
    const byName = this.callsByFile.get(rel);
    if (!byName) return [];
    const out: CallEdge[] = [];
    for (const list of byName.values()) out.push(...list);
    return out;
  }

  getStats(): StructuralStats {
    let callSites = 0;
    for (const byName of this.callsByFile.values()) {
      for (const list of byName.values()) callSites += list.length;
    }
    return {
      files: this.index.getStats().files,
      symbols: this.index.getStats().symbols,
      callSites,
      filesCached: this.fileCache.size,
      lastDeltaChanged: this.lastDeltaChanged,
    };
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private async ingestFile(rel: string, rootPath: string, content?: string): Promise<void> {
    let code = content ?? this.fileCache.get(rel);
    if (code === undefined) {
      try {
        code = await readFile(join(rootPath, rel), 'utf-8');
      } catch {
        return; // file vanished mid-delta — nothing to index
      }
      this.fileCache.set(rel, code);
    }

    const edges = new Map<string, CallEdge[]>();
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip declaration lines — their parenthesized parameter lists are not
      // call sites (function/class/interface/type/enum/const/let/var/import).
      if (DECLARATION_LINE_RE.test(line.trimStart())) continue;
      const re = new RegExp(CALL_SITE_RE.source, CALL_SITE_RE.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const callee = match[1];
        if (CONTROL_KEYWORDS.has(callee)) continue;
        if (this.index.querySymbol(callee).length === 0) continue; // unresolved → not a real edge
        const list = edges.get(callee) ?? [];
        list.push({ from: rel, callee, caller: 'top', line: i + 1 });
        edges.set(callee, list);
        const callers = this.callersByName.get(callee) ?? new Set<string>();
        callers.add(rel);
        this.callersByName.set(callee, callers);
      }
    }
    this.callsByFile.set(rel, edges);
  }

  private dropFile(rel: string): void {
    const edges = this.callsByFile.get(rel);
    if (edges) {
      for (const callee of edges.keys()) {
        const callers = this.callersByName.get(callee);
        callers?.delete(rel);
        if (callers && callers.size === 0) this.callersByName.delete(callee);
      }
      this.callsByFile.delete(rel);
    }
    this.fileCache.delete(rel);
  }
}

/** Canonical singleton (same instance used by the runtime surfaces). */
export const structuralContext = new StructuralContextEngine(indexStore);

export default StructuralContextEngine;
