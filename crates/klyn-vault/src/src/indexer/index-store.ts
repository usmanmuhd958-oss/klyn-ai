// =============================================================================
// KLYN AI OS — Incremental Index Store (Phase 1)
// File: src/indexer/index-store.ts
//
// The 3-level differential engine. `refresh()` is the single entry point that
// replaces per-query re-ingestion:
//
//   await indexStore.refresh(rootPath) -> IndexDelta
//
//   level 1 (file)    : ManifestLedger stat fast-path decides what to read.
//   level 2 (chunk)   : changed files are diffed chunk-by-chunk by content hash.
//   level 3 (symbol)  : only symbols in changed chunks are upserted; only
//                       symbols that depend on changed code are invalidated.
//
// Maintains an inverted name->symbol index and reverse import edges so callers
// can resolve "who depends on what" without re-scanning the repository.
// =============================================================================

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ManifestLedger, type ManifestEntry } from './manifest.js';
import { analyzeFile, fingerprintFile, type FileSymbols, type SymbolRecord } from './symbols.js';

export interface IndexDelta {
  /** True when any file was added, modified, or removed. */
  changed: boolean;
  /** True when the refresh was a pure fast-path (no file content read). */
  fastPath: boolean;
  added: string[];
  modified: string[];
  removed: string[];
  symbols: {
    upsert: SymbolRecord[];
    /** Symbol ids that must be re-resolved by consumers. */
    invalidate: string[];
  };
  filesScanned: number;
  filesRead: number;
  refreshMs: number;
}

export interface IndexStats {
  files: number;
  symbols: number;
  chunks: number;
  refreshCount: number;
  lastRefreshMs: number;
  lastDeltaChanged: boolean;
  rootPath: string | null;
}

interface CachedAnalysis {
  hash: string;
  parsed: FileSymbols;
}

interface ChunkSnapshot {
  id: string;
  hash: string;
  symbols: SymbolRecord[];
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

export class IndexStore {
  private ledger = new ManifestLedger();
  private symbolsByFile = new Map<string, Map<string, SymbolRecord>>();
  private chunksByFile = new Map<string, ChunkSnapshot[]>();
  private inverted = new Map<string, Set<string>>();
  /** Phase 5: symbol name -> repo-relative files declaring it (reverse map). */
  private symbolToFiles = new Map<string, Set<string>>();
  /** target file -> set of files that import from it (reverse edges). */
  private reverseImports = new Map<string, Set<string>>();
  /** file -> import edges, for rebuilding edges on change. */
  private importsByFile = new Map<string, Array<{ symbol: string; source: string }>>();
  private analysisCache = new Map<string, CachedAnalysis>();
  private refreshCount = 0;
  private lastRefreshMs = 0;
  private lastDeltaChanged = false;

  async refresh(rootPath: string): Promise<IndexDelta> {
    const start = performance.now();
    this.refreshCount++;

    const diff = await this.ledger.refresh(rootPath, (content, ext, rel) =>
      fingerprintFile(content, ext, rel)
    );

    const upsert: SymbolRecord[] = [];
    const invalidate = new Set<string>();
    const upsertSeen = new Set<string>();

    for (const rel of diff.added) {
      await this.ingestFile(rel, upsert, upsertSeen, invalidate);
    }
    for (const rel of diff.modified) {
      this.dropFile(rel, invalidate);
      await this.ingestFile(rel, upsert, upsertSeen, invalidate);
    }
    for (const rel of diff.removed) {
      this.dropFile(rel, invalidate);
    }

    this.lastRefreshMs = performance.now() - start;
    const changed = diff.added.length + diff.modified.length + diff.removed.length > 0;
    this.lastDeltaChanged = changed;

    return {
      changed,
      fastPath: !changed,
      added: diff.added,
      modified: diff.modified,
      removed: diff.removed,
      symbols: { upsert, invalidate: Array.from(invalidate) },
      filesScanned: diff.scannedFiles,
      filesRead: diff.readFiles,
      refreshMs: this.lastRefreshMs,
    };
  }

  // -------------------------------------------------------------------------
  // QUERIES
  // -------------------------------------------------------------------------

  getFileSymbols(path: string): SymbolRecord[] {
    return Array.from(this.symbolsByFile.get(path)?.values() ?? []);
  }

  /** All symbols (across files) with the given name. */
  querySymbol(name: string): SymbolRecord[] {
    const ids = this.inverted.get(name);
    if (!ids) return [];
    const out: SymbolRecord[] = [];
    for (const id of ids) {
      const file = id.substring(0, id.indexOf(':'));
      const rec = this.symbolsByFile.get(file)?.get(id);
      if (rec) out.push(rec);
    }
    return out;
  }

  /** Files (repo-relative) that declare a symbol with the given name. */
  getSymbolLocations(symbol: string): string[] {
    const files = this.symbolToFiles.get(symbol);
    return files ? Array.from(files).sort() : [];
  }

  /**
   * Phase 3: symbols whose NAME contains `fragment` (case-insensitive).
   * Used by the structural context engine to resolve lowercase/partial
   * query tokens that are not exact symbol names. Capped per fragment.
   */
  querySymbolsByFragment(fragment: string, limit = 8): SymbolRecord[] {
    const lower = fragment.toLowerCase();
    if (!lower) return [];
    const out: SymbolRecord[] = [];
    for (const [name, ids] of this.inverted) {
      if (!name.toLowerCase().includes(lower)) continue;
      for (const id of ids) {
        const file = id.substring(0, id.indexOf(':'));
        const rec = this.symbolsByFile.get(file)?.get(id);
        if (rec) out.push(rec);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** Batch symbol -> declaring-files lookup (used by CognitiveRouter). */
  querySymbolLocations(symbols: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const symbol of symbols) {
      const files = this.symbolToFiles.get(symbol);
      if (files && files.size > 0) out.set(symbol, Array.from(files).sort());
    }
    return out;
  }

  /** All repo-relative file paths currently indexed (graph enumeration). */
  getAllFiles(): string[] {
    return Array.from(this.symbolsByFile.keys()).sort();
  }

  /**
   * Direct import edges: file -> resolved files it imports (the local
   * dependency graph, NOT the transitive closure). Enumerated from the
   * per-file import lists maintained during ingestion — zero re-scanning.
   */
  getDirectImports(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const allPaths = new Set(this.symbolsByFile.keys());
    for (const [rel, imports] of this.importsByFile) {
      const targets: string[] = [];
      for (const imp of imports) {
        if (!imp.source.startsWith('.')) continue;
        const target = resolveImportPath(imp.source, rel, allPaths);
        if (target && target !== rel) targets.push(target);
      }
      out.set(rel, targets);
    }
    return out;
  }

  /** Files that (transitively) import from `path`. */
  getAffectedFiles(path: string): string[] {
    const affected = new Set<string>();
    const seen = new Set<string>();
    const traverse = (p: string) => {
      if (seen.has(p)) return;
      seen.add(p);
      const deps = this.reverseImports.get(p);
      if (!deps) return;
      for (const d of deps) {
        affected.add(d);
        traverse(d);
      }
    };
    traverse(path);
    return Array.from(affected).sort();
  }

  getManifestEntry(path: string): ManifestEntry | undefined {
    return this.ledger.get(path);
  }

  getStats(): IndexStats {
    let symbols = 0;
    for (const m of this.symbolsByFile.values()) symbols += m.size;
    let chunks = 0;
    for (const c of this.chunksByFile.values()) chunks += c.length;
    return {
      files: this.symbolsByFile.size,
      symbols,
      chunks,
      refreshCount: this.refreshCount,
      lastRefreshMs: this.lastRefreshMs,
      lastDeltaChanged: this.lastDeltaChanged,
      rootPath: this.ledger.rootPath,
    };
  }

  async saveLedger(file: string): Promise<void> {
    await this.ledger.saveTo(file);
  }

  async loadLedger(file: string): Promise<number> {
    return this.ledger.loadFrom(file);
  }

  reset(): void {
    this.ledger.clear();
    this.symbolsByFile.clear();
    this.chunksByFile.clear();
    this.inverted.clear();
    this.symbolToFiles.clear();
    this.reverseImports.clear();
    this.importsByFile.clear();
    this.analysisCache.clear();
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private async ingestFile(
    rel: string,
    upsert: SymbolRecord[],
    upsertSeen: Set<string>,
    invalidate: Set<string>
  ): Promise<void> {
    const entry = this.ledger.get(rel);
    if (!entry) return;

    const parsed = await this.parseFromDisk(rel, entry);
    this.analysisCache.set(`${rel}:${entry.hash}`, { hash: entry.hash, parsed });

    // --- chunk-level diff ------------------------------------------------
    const prevById = new Map((this.chunksByFile.get(rel) ?? []).map((c) => [c.id, c]));

    const symbols = new Map<string, SymbolRecord>();
    for (const chunk of parsed.chunks) {
      const prev = prevById.get(chunk.id);
      if (prev && prev.hash === chunk.hash) {
        // Unchanged chunk — its symbols are still valid; keep them.
        for (const s of prev.symbols) symbols.set(s.id, s);
        continue;
      }
      if (prev) {
        // Changed chunk — invalidate everything it used to define.
        for (const s of prev.symbols) invalidate.add(s.id);
      }
      for (const s of chunk.symbols) {
        symbols.set(s.id, s);
        if (!upsertSeen.has(s.id)) {
          upsertSeen.add(s.id);
          upsert.push(s);
        }
      }
    }

    this.symbolsByFile.set(rel, symbols);
    this.chunksByFile.set(rel, parsed.chunks.map((c) => ({ id: c.id, hash: c.hash, symbols: c.symbols })));

    // Maintain the reverse indexes for EVERY symbol this file currently
    // declares (kept + new). dropFile() above removed the stale entries, so
    // re-adding all of them here keeps `inverted` and `symbolToFiles`
    // consistent for modified files without re-scanning anything else.
    for (const s of symbols.values()) {
      const byName = this.inverted.get(s.name) ?? new Set<string>();
      byName.add(s.id);
      this.inverted.set(s.name, byName);

      const byFile = this.symbolToFiles.get(s.name) ?? new Set<string>();
      byFile.add(rel);
      this.symbolToFiles.set(s.name, byFile);
    }

    // --- reverse import edges ---------------------------------------------
    this.importsByFile.set(rel, parsed.imports.map((i) => ({ symbol: i.symbol, source: i.source })));
    this.rebuildReverseEdges(rel);
  }

  private async parseFromDisk(rel: string, entry: ManifestEntry): Promise<FileSymbols> {
    const key = `${rel}:${entry.hash}`;
    const cached = this.analysisCache.get(key);
    if (cached) return cached.parsed;

    const root = this.ledger.rootPath;
    const abs = root ? join(root, rel) : rel;
    const content = await readFile(abs, 'utf-8');
    const parsed = analyzeFile(content, rel);
    this.analysisCache.set(key, { hash: entry.hash, parsed });
    return parsed;
  }

  private rebuildReverseEdges(rel: string): void {
    // Remove all edges originating from this file, then re-add.
    for (const [target, sources] of this.reverseImports) {
      sources.delete(rel);
      if (sources.size === 0) this.reverseImports.delete(target);
    }
    const imports = this.importsByFile.get(rel) ?? [];
    const allPaths = new Set(this.symbolsByFile.keys());
    for (const imp of imports) {
      if (!imp.source.startsWith('.')) continue;
      const target = resolveImportPath(imp.source, rel, allPaths);
      if (target && target !== rel) {
        const set = this.reverseImports.get(target) ?? new Set<string>();
        set.add(rel);
        this.reverseImports.set(target, set);
      }
    }
  }

  private dropFile(rel: string, invalidate: Set<string>): void {
    const symbols = this.symbolsByFile.get(rel);
    if (symbols) {
      for (const s of symbols.values()) {
        invalidate.add(s.id);
        const byName = this.inverted.get(s.name);
        byName?.delete(s.id);
        if (byName && byName.size === 0) this.inverted.delete(s.name);
        const byFile = this.symbolToFiles.get(s.name);
        byFile?.delete(rel);
        if (byFile && byFile.size === 0) this.symbolToFiles.delete(s.name);
      }
    }
    this.symbolsByFile.delete(rel);
    this.chunksByFile.delete(rel);
    this.importsByFile.delete(rel);
    this.rebuildReverseEdges(rel);
  }
}

// ---------------------------------------------------------------------------
// IMPORT RESOLUTION (mirrors kernel AST dependency-graph candidate logic)
// ---------------------------------------------------------------------------

export function resolveImportPath(
  specifier: string,
  fromFile: string,
  allPaths: Set<string>
): string | null {
  if (!specifier.startsWith('.')) return null;

  const fromDir = fromFile.includes('/')
    ? fromFile.substring(0, fromFile.lastIndexOf('/'))
    : '';
  const base = normalizePath(fromDir ? `${fromDir}/${specifier}` : specifier);

  const candidates: string[] = [];
  const ext = base.includes('.') ? base.substring(base.lastIndexOf('.')) : '';
  if (ext && EXTENSIONS.includes(ext.toLowerCase())) {
    candidates.push(base, base.substring(0, base.lastIndexOf('.')));
  } else {
    candidates.push(base);
  }

  const expanded: string[] = [];
  for (const c of candidates) {
    expanded.push(c);
    for (const e of EXTENSIONS) expanded.push(c + e);
    for (const e of EXTENSIONS) expanded.push(`${c}/index${e}`);
  }
  for (const c of expanded) {
    if (allPaths.has(c)) return c;
  }
  return null;
}

function normalizePath(p: string): string {
  const parts = p.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/** Canonical singleton used across the runtime. */
export const indexStore = new IndexStore();

export default IndexStore;
