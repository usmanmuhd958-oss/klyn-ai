// 1.brain/patch_generator.ts
import { createHash } from 'node:crypto';

export interface UnifiedDiff {
  filePath: string;
  originalHash: string;
  newHash: string;
  hunks: DiffHunk[];
  operations: FileOperation[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete';
  content: string;
  lineNumber: number;
}

export type FileOperation = 
  | { type: 'create'; path: string; content: string }
  | { type: 'modify'; path: string; oldContent: string; newContent: string }
  | { type: 'delete'; path: string; oldContent: string };

export class PatchGenerator {
  private static readonly CONTEXT_LINES = 3;

  generateUnifiedDiff(
    filePath: string,
    oldContent: string,
    newContent: string
  ): UnifiedDiff {
    const originalHash = this.hashContent(oldContent);
    const newHash = this.hashContent(newContent);

    const hunks = this.computeHunks(oldContent, newContent);

    const operation: FileOperation = {
      type: 'modify',
      path: filePath,
      oldContent,
      newContent,
    };

    return {
      filePath,
      originalHash,
      newHash,
      hunks,
      operations: [operation],
    };
  }

  generateCreateDiff(filePath: string, content: string): UnifiedDiff {
    const newHash = this.hashContent(content);
    const lines = content.split('\n');

    const diffLines: DiffLine[] = lines.map((line, i) => ({
      type: 'add' as const,
      content: line,
      lineNumber: i + 1,
    }));

    const hunk: DiffHunk = {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      lines: diffLines,
    };

    const operation: FileOperation = {
      type: 'create',
      path: filePath,
      content,
    };

    return {
      filePath,
      originalHash: '',
      newHash,
      hunks: [hunk],
      operations: [operation],
    };
  }

  generateDeleteDiff(filePath: string, oldContent: string): UnifiedDiff {
    const originalHash = this.hashContent(oldContent);
    const lines = oldContent.split('\n');

    const diffLines: DiffLine[] = lines.map((line, i) => ({
      type: 'delete' as const,
      content: line,
      lineNumber: i + 1,
    }));

    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: lines.length,
      newStart: 0,
      newLines: 0,
      lines: diffLines,
    };

    const operation: FileOperation = {
      type: 'delete',
      path: filePath,
      oldContent,
    };

    return {
      filePath,
      originalHash,
      newHash: '',
      hunks: [hunk],
      operations: [operation],
    };
  }

  formatUnifiedDiff(diff: UnifiedDiff): string {
    const lines: string[] = [];

    lines.push(`--- a/${diff.filePath}`);
    lines.push(`+++ b/${diff.filePath}`);

    for (const hunk of diff.hunks) {
      lines.push(
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
      );

      for (const line of hunk.lines) {
        const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
        lines.push(`${prefix}${line.content}`);
      }
    }

    return lines.join('\n');
  }

  private computeHunks(oldContent: string, newContent: string): DiffHunk[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const diffs = this.computeDiff(oldLines, newLines);
    const hunks: DiffHunk[] = [];

    let currentHunk: DiffHunk | null = null;
    let contextBuffer: DiffLine[] = [];

    for (let i = 0; i < diffs.length; i++) {
      const diff = diffs[i];

      if (diff.type === 'context') {
        contextBuffer.push(diff);

        if (contextBuffer.length > PatchGenerator.CONTEXT_LINES * 2) {
          if (currentHunk) {
            const contextToAdd = contextBuffer.slice(0, PatchGenerator.CONTEXT_LINES);
            // Spread-push is O(k) but blows the argument stack for very large
            // hunks (whole-file rewrites); use a plain loop instead.
            for (const l of contextToAdd) currentHunk.lines.push(l);
            hunks.push(currentHunk);
            currentHunk = null;
          }

          contextBuffer = contextBuffer.slice(-PatchGenerator.CONTEXT_LINES);
        }
      } else {
        if (!currentHunk) {
          const preContext = contextBuffer.slice(-PatchGenerator.CONTEXT_LINES);

          currentHunk = {
            oldStart: Math.max(1, diff.lineNumber - preContext.length),
            oldLines: preContext.length,
            newStart: Math.max(1, diff.lineNumber - preContext.length),
            newLines: preContext.length,
            lines: preContext.slice(),
          };

          contextBuffer = [];
        }

        currentHunk.lines.push(diff);

        if (diff.type === 'delete') {
          currentHunk.oldLines++;
        } else if (diff.type === 'add') {
          currentHunk.newLines++;
        }
      }
    }

    if (currentHunk) {
      const postContext = contextBuffer.slice(0, PatchGenerator.CONTEXT_LINES);
      for (const l of postContext) currentHunk.lines.push(l);
      currentHunk.oldLines += postContext.filter(l => l.type !== 'add').length;
      currentHunk.newLines += postContext.filter(l => l.type !== 'delete').length;
      hunks.push(currentHunk);
    }

    return hunks;
  }

  // =========================================================================
  // Line diff engine.
  //
  // The previous implementation computed a full (m+1) x (n+1) LCS dynamic
  // program: O(m*n) time AND O(m*n) memory. Whole-file LLM rewrites routinely
  // exceed 5k lines, where the DP table alone costs hundreds of MB and can
  // OOM the process (10k x 10k => 10^8 numeric cells).
  //
  // Replacement strategy (correct, bounded, production-safe):
  //   1. Trim the common prefix/suffix — the overwhelmingly common case for
  //      incremental patches (localized edits in a large file) reduces the
  //      problem to a tiny core for free.
  //   2. Run the classic Myers O(ND) greedy search on the core, capped at
  //      D_MAX_CORE_EDITS edits. The trace (V per D) is bounded:
  //      D_CAP * O(core) ints, typically a few KB.
  //   3. When the cap is exceeded (pathological: two huge, fully different
  //      files), fall back to anchor-splitting recursion — O(N) memory,
  //      guaranteed to terminate, and produces a valid edit script (the
  //      reconstructed target is byte-identical even though it may not be
  //      the minimal edit distance).
  // =========================================================================

  private static readonly D_MAX_CORE_EDITS = 1024;
  /** Beyond this many core lines, Myers trace memory is not worth it; use anchors. */
  private static readonly CORE_LINES_FOR_ANCHORS = 8192;

  private computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    // 1) Trim common prefix.
    let prefix = 0;
    const maxPrefix = Math.min(oldLines.length, newLines.length);
    while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix++;

    // 2) Trim common suffix (never overlapping the prefix).
    let suffix = 0;
    const maxSuffix = Math.min(oldLines.length - prefix, newLines.length - prefix);
    while (suffix < maxSuffix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) {
      suffix++;
    }

    const diffs: DiffLine[] = [];

    // Common prefix → context lines.
    for (let i = 0; i < prefix; i++) {
      diffs.push({ type: 'context', content: oldLines[i], lineNumber: i + 1 });
    }

    const coreOld = oldLines.slice(prefix, oldLines.length - suffix);
    const coreNew = newLines.slice(prefix, newLines.length - suffix);

    if (coreOld.length + coreNew.length > 0) {
      if (coreOld.length + coreNew.length <= PatchGenerator.CORE_LINES_FOR_ANCHORS) {
        this.myersDiff(coreOld, coreNew, diffs, prefix, prefix);
      } else {
        this.anchorSplit(coreOld, 0, coreOld.length, coreNew, 0, coreNew.length, diffs, prefix, prefix, 0);
      }
    }

    // Common suffix → context lines.
    for (let i = 0; i < suffix; i++) {
      diffs.push({
        type: 'context',
        content: oldLines[oldLines.length - suffix + i],
        lineNumber: oldLines.length - suffix + i + 1,
      });
    }

    return diffs;
  }

  /** Emit a DiffLine[] for a[aLo..aHi) vs b[bLo..bHi) where both slices are
   *  already trimmed of common prefix/suffix. `outOldBase`/`outNewBase` are
   *  the absolute (1-based) line offsets of a[aLo] / b[bLo] in the original
   *  files. */
  private myersDiff(
    a: string[],
    b: string[],
    out: DiffLine[],
    outOldBase: number,
    outNewBase: number
  ): void {
    this.myersRange(a, 0, a.length, b, 0, b.length, out, outOldBase, outNewBase, 0);
  }

  private myersRange(
    a: string[],
    aLo: number,
    aHi: number,
    b: string[],
    bLo: number,
    bHi: number,
    out: DiffLine[],
    outOldBase: number,
    outNewBase: number,
    depth: number
  ): void {
    // Trim common prefix/suffix of this range (cheap, and keeps D small).
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) { aLo++; bLo++; }
    while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi--; }

    if (aLo >= aHi) {
      for (let i = bLo; i < bHi; i++) {
        out.push({ type: 'add', content: b[i], lineNumber: outNewBase + i + 1 });
      }
      return;
    }
    if (bLo >= bHi) {
      for (let i = aLo; i < aHi; i++) {
        out.push({ type: 'delete', content: a[i], lineNumber: outOldBase + i + 1 });
      }
      return;
    }

    const n = aHi - aLo;
    const m = bHi - bLo;
    const maxD = n + m;
    const dCap = Math.min(maxD, PatchGenerator.D_MAX_CORE_EDITS);

    // V[k] = furthest x on diagonal k. Index offset so k in [-dCap, dCap].
    const vSize = 2 * dCap + 3;
    const off = dCap + 1;
    const v = new Int32Array(vSize);
    v[off + 1] = 0;

    // Trace: one V snapshot per edit-depth (needed for backtracking).
    const trace: Int32Array[] = [];
    let found = false;

    for (let d = 0; d <= dCap && !found; d++) {
      const kLo = -d;
      const kHi = d;
      for (let k = kLo; k <= kHi; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) {
          x = v[off + k + 1]; // vertical move (insert)
        } else {
          x = v[off + k - 1] + 1; // horizontal move (delete)
        }
        let y = x - k;
        while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) {
          found = true;
          break;
        }
      }
      // Snapshot AFTER the depth's updates: trace[d] must hold the V state
      // of depth d (diagonals |k| > d still carry depth-(d-1) values, which
      // the backtracking walk relies on).
      trace.push(v.slice());
    }

    if (found) {
      // Backtrack through the trace to recover the edit script. Per the
      // classic Myers algorithm, the depth-d snapshot is used both for the
      // predecessor-diagonal choice and the predecessor x lookup: the
      // snapshot still holds the depth-(d-1) value on diagonals that depth d
      // did not reach (|k| > d), which is exactly what the walk needs.
      const script: Array<{ kind: 'ctx' | 'ins' | 'del'; oldIdx: number; newIdx: number }> = [];
      let x = n;
      let y = m;
      for (let d = trace.length - 1; d >= 0; d--) {
        const v = trace[d];
        const k = x - y;
        let prevK: number;
        if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) {
          prevK = k + 1;
        } else {
          prevK = k - 1;
        }
        const prevX = v[off + prevK];
        const prevY = prevX - prevK;
        // Snake: matching lines consumed by both sides.
        while (x > prevX && y > prevY) {
          script.push({ kind: 'ctx', oldIdx: x - 1, newIdx: y - 1 });
          x--;
          y--;
        }
        if (d > 0) {
          if (x === prevX) {
            script.push({ kind: 'ins', oldIdx: -1, newIdx: y - 1 });
            y--;
          } else {
            script.push({ kind: 'del', oldIdx: x - 1, newIdx: -1 });
            x--;
          }
        }
      }
      script.reverse();
      for (const step of script) {
        if (step.kind === 'ctx') {
          out.push({ type: 'context', content: a[step.oldIdx], lineNumber: outOldBase + step.oldIdx + 1 });
        } else if (step.kind === 'ins') {
          out.push({ type: 'add', content: b[step.newIdx], lineNumber: outNewBase + step.newIdx + 1 });
        } else {
          out.push({ type: 'delete', content: a[step.oldIdx], lineNumber: outOldBase + step.oldIdx + 1 });
        }
      }
      return;
    }

    // D cap exceeded: fall back to anchor splitting (guaranteed O(N) memory).
    if (depth >= 64) {
      // Extreme recursion guard: emit the remaining ranges verbatim.
      for (let i = aLo; i < aHi; i++) {
        out.push({ type: 'delete', content: a[i], lineNumber: outOldBase + i + 1 });
      }
      for (let i = bLo; i < bHi; i++) {
        out.push({ type: 'add', content: b[i], lineNumber: outNewBase + i + 1 });
      }
      return;
    }
    this.anchorSplit(a, aLo, aHi, b, bLo, bHi, out, outOldBase, outNewBase, depth);
  }

  /**
   * Anchor-splitting fallback: pick the rarest line present in both ranges
   * (preferring one near the middle), split both ranges on it, and recurse.
   * Produces a valid edit script in O(N) memory for pathological inputs.
   */
  private anchorSplit(
    a: string[],
    aLo: number,
    aHi: number,
    b: string[],
    bLo: number,
    bHi: number,
    out: DiffLine[],
    outOldBase: number,
    outNewBase: number,
    depth: number
  ): void {
    const n = aHi - aLo;
    const m = bHi - bLo;

    // Count occurrences in each range.
    const countA = new Map<string, number>();
    for (let i = aLo; i < aHi; i++) countA.set(a[i], (countA.get(a[i]) ?? 0) + 1);
    const countB = new Map<string, number>();
    for (let i = bLo; i < bHi; i++) countB.set(b[i], (countB.get(b[i]) ?? 0) + 1);

    // Candidate anchors: lines present in both ranges, ranked by rarity and
    // by proximity to the middle of the range.
    let bestScore = Infinity;
    let bestALine = -1;
    let bestBLine = -1;
    const mid = (aLo + aHi + bLo + bHi) / 2;
    for (const [line, ca] of countA) {
      const cb = countB.get(line);
      if (cb === undefined) continue;
      // Rarity first; tie-break by distance to the middle of the ranges.
      const rarity = ca + cb;
      if (rarity > bestScore) continue;
      // Find first occurrences (cheapest: first occurrence in each range).
      const ai = a.indexOf(line, aLo);
      const bi = b.indexOf(line, bLo);
      if (ai < 0 || bi < 0 || ai >= aHi || bi >= bHi) continue;
      const dist = Math.abs(ai + bi - mid);
      const score = rarity * 1e9 + dist;
      if (score < bestScore) {
        bestScore = score;
        bestALine = ai;
        bestBLine = bi;
      }
    }

    if (bestALine < 0) {
      // No common line: the ranges are disjoint. Emit verbatim.
      for (let i = aLo; i < aHi; i++) {
        out.push({ type: 'delete', content: a[i], lineNumber: outOldBase + i + 1 });
      }
      for (let i = bLo; i < bHi; i++) {
        out.push({ type: 'add', content: b[i], lineNumber: outNewBase + i + 1 });
      }
      return;
    }

    // Recurse on the four quadrants around the anchor line.
    this.myersRange(a, aLo, bestALine, b, bLo, bestBLine, out, outOldBase, outNewBase, depth + 1);
    out.push({ type: 'context', content: a[bestALine], lineNumber: outOldBase + bestALine + 1 });
    this.myersRange(a, bestALine + 1, aHi, b, bestBLine + 1, bHi, out, outOldBase, outNewBase, depth + 1);
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
