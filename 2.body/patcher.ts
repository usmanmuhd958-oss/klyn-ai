/**
 * KLYN AI OS - AST-Aware Code Patcher
 * Atomic code patching with rollback capability
 */

// @ts-ignore
import fs from 'fs/promises';
// @ts-ignore
import path from 'path';
import { randomUUID } from 'crypto';
// @ts-ignore
import { CodeValidator } from './validator.ts';
// @ts-ignore
import { kernelBus } from '../0.kernel/bus.ts';
import type { CodePatch, Change } from '../0.kernel/types.ts';

export interface PatchOptions {
  validate?: boolean;
  backup?: boolean;
  autoRollback?: boolean;
}

export interface PatchResult {
  success: boolean;
  patchId: string;
  filePath: string;
  backupPath?: string;
  errors: string[];
  applied: boolean;
  rolledBack: boolean;
}

export class CodePatcher {
  [key: string]: any;
  private validator: CodeValidator;
  private backupDir: string;
  private patches: Map<string, CodePatch> = new Map();

  constructor(backupDir = './.klyn/backups') {
    this.validator = new CodeValidator();
    this.backupDir = backupDir;
  }

  /**
   * Apply code patch to file
   */
  async applyPatch(
    filePath: string,
    patchedContent: string,
    reason: string,
    options: PatchOptions = { validate: true, backup: true, autoRollback: true }
  ): Promise<PatchResult> {
    const patchId = randomUUID();
    const absolutePath = path.resolve(filePath);

    console.log(`[Patcher] 🔧 Applying patch to: ${filePath}`);

    const result: PatchResult = {
      success: false,
      patchId,
      filePath: absolutePath,
      errors: [],
      applied: false,
      rolledBack: false,
    };

    try {
      // Read original content
      const originalContent = await fs.readFile(absolutePath, 'utf-8');

      // Create backup if enabled
      let backupPath: string | undefined;
      if (options.backup) {
        backupPath = await this.createBackup(absolutePath, originalContent, patchId);
        result.backupPath = backupPath;
      }

      // Validate patched code
      if (options.validate) {
        const validation = this.validator.validate(patchedContent, filePath);

        if (!validation.valid) {
          result.errors = validation.errors.map(e => 
            `Line ${e.line}:${e.column} - ${e.message}`
          );

          console.error(`[Patcher] ❌ Validation failed:`, result.errors);

          kernelBus.publish(
            'patch.failed',
            { patchId, filePath, errors: result.errors, reason: 'validation_failed' },
            'patcher',
            patchId
          );

          return result;
        }

        console.log(`[Patcher] ✅ Validation passed`);
      }

      // Calculate changes
      const changes = this.calculateChanges(originalContent, patchedContent);

      // Create patch record
      const patch: CodePatch = {
        id: patchId,
        filePath: absolutePath,
        original: originalContent,
        patched: patchedContent,
        changes,
        validation: {
          syntaxValid: true,
          errors: [],
        },
        metadata: {
          generatedBy: 'healer',
          reason,
          timestamp: new Date(),
        },
      };

      this.patches.set(patchId, patch);

      // Apply patch atomically
      await this.atomicWrite(absolutePath, patchedContent);

      result.success = true;
      result.applied = true;

      console.log(`[Patcher] ✅ Patch applied successfully`);
      console.log(`[Patcher] 📝 Changes: ${changes.length} modifications`);

      kernelBus.publish(
        'patch.applied',
        { patchId, filePath, changes, reason },
        'patcher',
        patchId
      );

      return result;

    } catch (error) {
      const errorMsg = (error as Error).message;
      result.errors.push(errorMsg);

      console.error(`[Patcher] 💥 Error:`, error);

      // Auto-rollback on error
      if (options.autoRollback && result.backupPath) {
        console.log(`[Patcher] 🔄 Auto-rollback initiated`);
        await this.rollback(patchId);
        result.rolledBack = true;
      }

      kernelBus.publish(
        'patch.failed',
        { patchId, filePath, error: errorMsg },
        'patcher',
        patchId
      );

      return result;
    }
  }

  /**
   * Apply multi-line replacement patch
   */
  async applyReplacementPatch(
    filePath: string,
    searchPattern: string | RegExp,
    replacement: string,
    reason: string,
    options?: PatchOptions
  ): Promise<PatchResult> {
    const absolutePath = path.resolve(filePath);
    const originalContent = await fs.readFile(absolutePath, 'utf-8');

    const patchedContent = typeof searchPattern === 'string'
      ? originalContent.replace(searchPattern, replacement)
      : originalContent.replace(searchPattern, replacement);

    if (patchedContent === originalContent) {
      console.warn(`[Patcher] ⚠️  No changes detected for pattern`);
    }

    return this.applyPatch(filePath, patchedContent, reason, options);
  }

  /**
   * Apply line-specific patch
   */
  async applyLinePatch(
    filePath: string,
    lineNumber: number,
    newLine: string,
    reason: string,
    options?: PatchOptions
  ): Promise<PatchResult> {
    const absolutePath = path.resolve(filePath);
    const originalContent = await fs.readFile(absolutePath, 'utf-8');
    const lines = originalContent.split('\n');

    if (lineNumber < 1 || lineNumber > lines.length) {
      throw new Error(`Invalid line number: ${lineNumber}`);
    }

    lines[lineNumber - 1] = newLine;
    const patchedContent = lines.join('\n');

    return this.applyPatch(filePath, patchedContent, reason, options);
  }

  /**
   * Rollback patch
   */
  async rollback(patchId: string): Promise<boolean> {
    const patch = this.patches.get(patchId);
    if (!patch) {
      console.error(`[Patcher] ❌ Patch not found: ${patchId}`);
      return false;
    }

    console.log(`[Patcher] 🔄 Rolling back patch: ${patchId}`);

    try {
      await this.atomicWrite(patch.filePath, patch.original);

      console.log(`[Patcher] ✅ Rollback successful`);

      kernelBus.publish(
        'patch.rolled_back',
        { patchId, filePath: patch.filePath },
        'patcher',
        patchId
      );

      return true;
    } catch (error) {
      console.error(`[Patcher] ❌ Rollback failed:`, error);
      return false;
    }
  }

  /**
   * Get patch by ID
   */
  getPatch(patchId: string): CodePatch | undefined {
    return this.patches.get(patchId);
  }

  /**
   * Get all patches for file
   */
  getPatchesForFile(filePath: string): CodePatch[] {
    const absolutePath = path.resolve(filePath);
    return Array.from(this.patches.values())
      .filter(p => p.filePath === absolutePath);
  }

  private async createBackup(
    filePath: string,
    content: string,
    patchId: string
  ): Promise<string> {
    // Ensure backup directory exists
    await fs.mkdir(this.backupDir, { recursive: true });

    const filename = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `${filename}.${timestamp}.${patchId.slice(0, 8)}.backup`;
    const backupPath = path.join(this.backupDir, backupFilename);

    await fs.writeFile(backupPath, content, 'utf-8');

    console.log(`[Patcher] 💾 Backup created: ${backupPath}`);

    return backupPath;
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp.${randomUUID().slice(0, 8)}`;

    try {
      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  private calculateChanges(original: string, patched: string): Change[] {
    const changes: Change[] = [];
    const originalLines = original.split('\n');
    const patchedLines = patched.split('\n');

    const maxLines = Math.max(originalLines.length, patchedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i];
      const patchLine = patchedLines[i];

      if (origLine === undefined && patchLine !== undefined) {
        changes.push({
          type: 'insert',
          line: i + 1,
          replacement: patchLine,
        });
      } else if (origLine !== undefined && patchLine === undefined) {
        changes.push({
          type: 'delete',
          line: i + 1,
          original: origLine,
        });
      } else if (origLine !== patchLine) {
        changes.push({
          type: 'replace',
          line: i + 1,
          original: origLine,
          replacement: patchLine,
        });
      }
    }

    return changes;
  }
}
