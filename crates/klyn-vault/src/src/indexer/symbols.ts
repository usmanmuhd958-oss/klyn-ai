// =============================================================================
// KLYN AI OS — Structural Symbol Scanner (Phase 1)
// File: src/indexer/symbols.ts
//
// Zero-dependency, brace-aware structural analyzer. Produces the 3-level
// differential granularity the IndexStore needs:
//   file   -> ManifestLedger (sha256 of content)
//   chunk  -> top-level declaration bodies, each with its own content hash
//   symbol -> declarations (class/function/…) + nested methods + import edges,
//             each with a stable id and a signature fingerprint
//
// Not a full parser: it is intentionally cheap (single pass, line based) and
// conservative — structural changes always invalidate, never silently pass.
// =============================================================================

import { sha256 } from './manifest.js';

export type SymbolKind =
  | 'class' | 'function' | 'method' | 'interface' | 'type' | 'enum'
  | 'const' | 'let' | 'var' | 'import';

export interface SymbolRecord {
  id: string;
  name: string;
  kind: SymbolKind;
  file: string;
  parentId: string | null;
  startLine: number;
  endLine: number;
  /** Hash over the symbol's kind/name/parent and cleaned body — changes when
   *  the symbol's structure or content actually changes. */
  fingerprint: string;
}

export interface SymbolChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  hash: string;
  symbols: SymbolRecord[];
}

export interface ImportEdge {
  symbol: string;
  source: string;
  line: number;
  isDefault: boolean;
  isNamespace: boolean;
}

export interface ExportEdge {
  symbol: string;
  line: number;
  isDefault: boolean;
}

export interface FileSymbols {
  path: string;
  chunks: SymbolChunk[];
  symbols: SymbolRecord[];
  imports: ImportEdge[];
  exports: ExportEdge[];
}

// ---------------------------------------------------------------------------
// TOP-LEVEL DECLARATION MATCHING
// ---------------------------------------------------------------------------

const TOP_LEVEL_RE = new RegExp(
  '^' +
    '(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:default\\s+)?' +
    '(?:function|class|interface|type|enum)\\s+' +
    '([A-Za-z_$][\\w$]*)' +
    '|' +
    '^(?:export\\s+)?(?:const|let|var)\\s+' +
    '([A-Za-z_$][\\w$]*)'
);

const METHOD_RE = /^\s+(?:(?:public|private|protected|static|readonly|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(/;

const IMPORT_RE = /import\s+(?:type\s+)?(?:([\w$]+)\s+from\s+|(\*)\s+as\s+([\w$]+)\s+from\s+|\{([^}]+)\}\s+from\s+|\(\s*)?['"]([^'"]+)['"]/;

const REQUIRE_RE = /(?:const|let|var)\s+(?:\{([^}]+)\}|([\w$]+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/;

const EXPORT_NAMED_RE = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;

const EXPORT_DEFAULT_RE = /export\s+default\s+(?:(?:function|class)\s+)?(\w+)?/;

const EXPORT_LIST_RE = /export\s+\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?/;

/**
 * Analyze a source file into chunks + symbols + import/export edges.
 * Deterministic: identical input yields identical output.
 */
export function analyzeFile(content: string, filePath: string): FileSymbols {
  const lines = content.split('\n');
  const records: SymbolRecord[] = [];
  const chunks: SymbolChunk[] = [];
  const imports: ImportEdge[] = [];
  const exports: ExportEdge[] = [];

  let depth = 0;
  let inBlock = false;
  let pending: {
    name: string;
    kind: SymbolKind;
    startLine: number;
    opened: boolean;
    openDepth: number;
    bodyLines: number[];
  } | null = null;

  let currentClass: { name: string; id: string } | null = null;
  let classMethods: SymbolRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const { clean, stillInBlock } = stripComments(raw, inBlock);
    inBlock = stillInBlock;
    const preDepth = depth;
    depth += braceDelta(clean);
    const postDepth = Math.max(0, depth);

    // --- pending chunk tracking -------------------------------------------
    if (pending) {
      pending.bodyLines.push(i);
      if (!pending.opened) {
        if (clean.includes('{')) {
          pending.opened = true;
          pending.openDepth = preDepth;
        } else if (
          (clean.includes(';') || clean.includes('}')) &&
          postDepth <= pending.openDepth
        ) {
          closeChunk(pending, i);
        }
      } else if (postDepth <= pending.openDepth) {
        closeChunk(pending, i);
      }
      if (!pending) {
        continue;
      }
    }

    // --- method detection inside a class chunk -----------------------------
    if (currentClass && preDepth >= 1) {
      const m = clean.match(METHOD_RE);
      if (m && !clean.startsWith('return ') && !/^(if|for|while|switch)\b/.test(clean)) {
        classMethods.push({
          id: `${filePath}:${currentClass.name}.${m[1]}:method`,
          name: m[1],
          kind: 'method',
          file: filePath,
          parentId: currentClass.id,
          startLine: i,
          endLine: i,
          fingerprint: sha256(`method|${m[1]}|${currentClass.id}`),
        });
      }
    }

    // --- top-level declaration → new chunk ----------------------------------
    if (preDepth === 0) {
      const m = clean.match(TOP_LEVEL_RE);
      if (m && !currentClass) {
        const name = m[1] ?? m[2];
        const kind = classifyDecl(clean);
        // A declaration whose opening brace sits on its own line (the
        // overwhelmingly common style) must be marked opened immediately;
        // otherwise the next top-level line would close the chunk and absorb
        // the following declaration.
        const opensInline = clean.includes('{');
        pending = {
          name,
          kind,
          startLine: i,
          opened: opensInline,
          openDepth: preDepth,
          bodyLines: [i],
        };
        if (kind === 'class') {
          currentClass = { name, id: `${filePath}:${name}:class` };
        }
      }
    }
  }

  if (pending) {
    closeChunk(pending, lines.length - 1);
  }

  parseImports(lines, imports);
  parseExports(lines, exports);

  return { path: filePath, chunks, symbols: records, imports, exports };

  // -------------------------------------------------------------------------
  function closeChunk(p: NonNullable<typeof pending>, endLine: number): void {
    const bodyLines = lines
      .slice(p.startLine, endLine + 1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const chunkHash = sha256(bodyLines.join('\n'));
    const chunkId = `${filePath}:${p.startLine}`;

    const chunkSymbols: SymbolRecord[] = [];
    if (p.kind !== 'class') {
      // standalone top-level symbol
      chunkSymbols.push(makeRecord(p.name, p.kind, filePath, null, p.startLine, endLine, bodyLines));
    } else {
      const classId = `${filePath}:${p.name}:class`;
      chunkSymbols.push(makeRecord(p.name, 'class', filePath, null, p.startLine, endLine, bodyLines));
      // attach methods declared inside this chunk (buffered during scan)
      for (const rec of classMethods) {
        if (rec.parentId === classId && rec.startLine >= p.startLine) {
          rec.endLine = endLine;
          chunkSymbols.push(rec);
        }
      }
      classMethods = [];
    }

    for (const s of chunkSymbols) records.push(s);
    chunks.push({ id: chunkId, path: filePath, startLine: p.startLine, endLine, hash: chunkHash, symbols: chunkSymbols });

    if (p.kind === 'class') currentClass = null;
    pending = null;
  }

  function makeRecord(
    name: string,
    kind: SymbolKind,
    file: string,
    parentId: string | null,
    startLine: number,
    endLine: number,
    bodyLines: string[]
  ): SymbolRecord {
    return {
      id: `${file}:${parentId ? `${parentId}.` : ''}${name}:${kind}`,
      name,
      kind,
      file,
      parentId,
      startLine,
      endLine,
      fingerprint: sha256(`${kind}|${name}|${parentId ?? ''}|${bodyLines.join('\n')}`),
    };
  }
}

function classifyDecl(cleanLine: string): SymbolKind {
  if (/\bclass\b/.test(cleanLine)) return 'class';
  if (/\binterface\b/.test(cleanLine)) return 'interface';
  if (/\btype\b/.test(cleanLine)) return 'type';
  if (/\benum\b/.test(cleanLine)) return 'enum';
  if (/\bfunction\b/.test(cleanLine)) return 'function';
  if (/\bconst\b/.test(cleanLine)) return 'const';
  if (/\blet\b/.test(cleanLine)) return 'let';
  return 'var';
}

// ---------------------------------------------------------------------------
// IMPORT / EXPORT EDGES (line-based, same patterns as kernel AST dep graph)
// ---------------------------------------------------------------------------

function parseImports(lines: string[], out: ImportEdge[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const im = line.match(IMPORT_RE);
    if (im) {
      const source = im[5];
      const named = im[4];
      if (named) {
        for (const s of named.split(',').map((x) => x.trim())) {
          const parts = s.split(/\s+as\s+/);
          out.push({ symbol: parts[0].trim(), source, line: lineNum, isDefault: false, isNamespace: false });
        }
      } else if (im[2] === '*') {
        out.push({ symbol: im[3], source, line: lineNum, isDefault: false, isNamespace: true });
      } else if (im[1]) {
        out.push({ symbol: im[1], source, line: lineNum, isDefault: true, isNamespace: false });
      }
      continue;
    }

    const rm = line.match(REQUIRE_RE);
    if (rm) {
      const source = rm[3];
      if (rm[1]) {
        for (const s of rm[1].split(',').map((x) => x.trim())) {
          const parts = s.split(':');
          out.push({ symbol: parts[0].trim(), source, line: lineNum, isDefault: false, isNamespace: false });
        }
      } else if (rm[2]) {
        out.push({ symbol: rm[2], source, line: lineNum, isDefault: true, isNamespace: false });
      }
    }
  }
}

function parseExports(lines: string[], out: ExportEdge[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    let m: RegExpExecArray | null;
    while ((m = EXPORT_NAMED_RE.exec(line)) !== null) {
      out.push({ symbol: m[1], line: lineNum, isDefault: false });
    }
    m = EXPORT_DEFAULT_RE.exec(line);
    if (m) out.push({ symbol: m[1] ?? 'default', line: lineNum, isDefault: true });

    const lm = line.match(EXPORT_LIST_RE);
    if (lm) {
      for (const s of lm[1].split(',').map((x) => x.trim())) {
        const parts = s.split(/\s+as\s+/);
        out.push({ symbol: parts.length > 1 ? parts[1].trim() : parts[0].trim(), line: lineNum, isDefault: false });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// COMMENT / STRING-AWARE BRACE COUNTING
// ---------------------------------------------------------------------------

/** Strip comments and string bodies from a line; track block-comment state.
 *  Returns { clean, stillInBlock }. */
function stripComments(line: string, inBlock: boolean): { clean: string; stillInBlock: boolean } {
  let out = '';
  let i = 0;
  let inStr: '"' | "'" | '`' | null = null;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (inStr) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return { clean: out, stillInBlock: inBlock };
}

function braceDelta(clean: string): number {
  let d = 0;
  for (const ch of clean) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
  }
  return d;
}

// ---------------------------------------------------------------------------
// MANIFEST FINGERPRINT HOOK
// ---------------------------------------------------------------------------

/**
 * Structural fingerprint for the manifest ledger: a hash over the sorted set
 * of (name, kind, parent) triples. Changes whenever file structure changes,
 * stable under pure whitespace/comment edits.
 */
export function fingerprintFile(content: string, _ext: string, filePath: string): string {
  try {
    const { symbols } = analyzeFile(content, filePath);
    const sig = symbols
      .map((s) => `${s.kind}|${s.name}|${s.parentId ?? ''}`)
      .sort()
      .join('\n');
    return sha256(sig);
  } catch {
    return sha256(content);
  }
}

export default analyzeFile;
