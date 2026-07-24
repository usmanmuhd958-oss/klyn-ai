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
            currentHunk.lines.push(...contextToAdd);
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
            lines: [...preContext],
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
      currentHunk.lines.push(...postContext);
      currentHunk.oldLines += postContext.filter(l => l.type !== 'add').length;
      currentHunk.newLines += postContext.filter(l => l.type !== 'delete').length;
      hunks.push(currentHunk);
    }

    return hunks;
  }

  private computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const lcs = this.longestCommonSubsequence(oldLines, newLines);
    const diffs: DiffLine[] = [];

    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
        diffs.push({
          type: 'context',
          content: oldLines[oldIdx],
          lineNumber: oldIdx + 1,
        });
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else if (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
        diffs.push({
          type: 'add',
          content: newLines[newIdx],
          lineNumber: newIdx + 1,
        });
        newIdx++;
      } else if (oldIdx < oldLines.length) {
        diffs.push({
          type: 'delete',
          content: oldLines[oldIdx],
          lineNumber: oldIdx + 1,
        });
        oldIdx++;
      }
    }

    return diffs;
  }

  private longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const lcs: string[] = [];
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        lcs.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
