// 1.brain/patch_validator.ts
import type { UnifiedDiff, FileOperation } from './patch_generator.js';
import type { ASTDependencyGraph } from '../kernel/src/ast/dependency_graph.js';
import { readFile } from 'node:fs/promises';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'syntax' | 'import' | 'export' | 'hash' | 'dependency';
  message: string;
  filePath: string;
  line?: number;
}

export interface ValidationWarning {
  type: 'unused' | 'circular' | 'complexity';
  message: string;
  filePath: string;
}

export class PatchValidator {
  constructor(private depGraph?: ASTDependencyGraph) {}

  async validateDiff(diff: UnifiedDiff, dryRun: boolean = true): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const operation of diff.operations) {
      if (operation.type === 'modify') {
        const hashError = await this.validateHash(operation.path, operation.oldContent);
        if (hashError) errors.push(hashError);

        const syntaxErrors = this.validateSyntax(operation.newContent, operation.path);
        errors.push(...syntaxErrors);

        const importErrors = await this.validateImports(operation.newContent, operation.path);
        errors.push(...importErrors);

        const exportWarnings = this.validateExports(operation.newContent, operation.path);
        warnings.push(...exportWarnings);
      } else if (operation.type === 'create') {
        const syntaxErrors = this.validateSyntax(operation.content, operation.path);
        errors.push(...syntaxErrors);

        const importErrors = await this.validateImports(operation.content, operation.path);
        errors.push(...importErrors);
      } else if (operation.type === 'delete') {
        const depErrors = await this.validateDeletion(operation.path);
        errors.push(...depErrors);
      }
    }

    if (this.depGraph && dryRun) {
      const circularWarnings = this.checkCircularDependencies();
      warnings.push(...circularWarnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async validateBatch(diffs: UnifiedDiff[]): Promise<ValidationResult> {
    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationWarning[] = [];

    for (const diff of diffs) {
      const result = await this.validateDiff(diff, true);
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  private async validateHash(filePath: string, expectedContent: string): Promise<ValidationError | null> {
    try {
      const actualContent = await readFile(filePath, 'utf-8');
      
      if (actualContent !== expectedContent) {
        return {
          type: 'hash',
          message: `File content mismatch: ${filePath} has been modified since analysis`,
          filePath,
        };
      }
    } catch (error) {
      return {
        type: 'hash',
        message: `Cannot read file: ${filePath}`,
        filePath,
      };
    }

    return null;
  }

  private validateSyntax(content: string, filePath: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const ext = filePath.split('.').pop();

    if (!ext || !['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
      return errors;
    }

    const brackets = { '{': 0, '[': 0, '(': 0 };
    const closeBrackets = { '}': '{', ']': '[', ')': '(' };
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char in brackets) {
          brackets[char as keyof typeof brackets]++;
        } else if (char in closeBrackets) {
          const open = closeBrackets[char as keyof typeof closeBrackets];
          brackets[open as keyof typeof brackets]--;
        }
      }
    }

    for (const [bracket, count] of Object.entries(brackets)) {
      if (count !== 0) {
        errors.push({
          type: 'syntax',
          message: `Unmatched ${bracket}: ${count > 0 ? 'unclosed' : 'extra closing'}`,
          filePath,
        });
      }
    }

    return errors;
  }

  private async validateImports(content: string, filePath: string): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    const lines = content.split('\n');

    const importRegex = /import\s+.+\s+from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      let match;
      while ((match = importRegex.exec(line)) !== null) {
        const importPath = match[1];

        if (importPath.startsWith('.')) {
          const isValid = await this.checkRelativeImport(importPath, filePath);
          if (!isValid) {
            errors.push({
              type: 'import',
              message: `Cannot resolve import: ${importPath}`,
              filePath,
              line: lineNum,
            });
          }
        }
      }

      while ((match = requireRegex.exec(line)) !== null) {
        const importPath = match[1];

        if (importPath.startsWith('.')) {
          const isValid = await this.checkRelativeImport(importPath, filePath);
          if (!isValid) {
            errors.push({
              type: 'import',
              message: `Cannot resolve require: ${importPath}`,
              filePath,
              line: lineNum,
            });
          }
        }
      }
    }

    return errors;
  }

  private validateExports(content: string, filePath: string): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const lines = content.split('\n');

    const exportRegex = /export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/g;
    const exports = new Set<string>();

    for (const line of lines) {
      let match;
      while ((match = exportRegex.exec(line)) !== null) {
        exports.add(match[1]);
      }
    }

    if (this.depGraph) {
      const fileNode = this.depGraph.getFileNode(filePath);
      if (fileNode) {
        for (const exportName of exports) {
          const consumers = this.depGraph.getSymbolConsumers(filePath, exportName);
          if (consumers.length === 0) {
            warnings.push({
              type: 'unused',
              message: `Export '${exportName}' is not used by any file`,
              filePath,
            });
          }
        }
      }
    }

    return warnings;
  }

  private async validateDeletion(filePath: string): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    if (this.depGraph) {
      const dependents = this.depGraph.getDirectDependencies(filePath);

      if (dependents.length > 0) {
        errors.push({
          type: 'dependency',
          message: `Cannot delete ${filePath}: ${dependents.length} files depend on it`,
          filePath,
        });
      }
    }

    return errors;
  }

  private checkCircularDependencies(): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    if (this.depGraph) {
      const cycles = this.depGraph.findCircularImports();

      for (const cycle of cycles) {
        for (const filePath of cycle) {
          warnings.push({
            type: 'circular',
            message: `File is part of circular dependency: ${cycle.join(' → ')}`,
            filePath,
          });
        }
      }
    }

    return warnings;
  }

  private async checkRelativeImport(importPath: string, fromFile: string): Promise<boolean> {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
    const basePath = this.resolveRelativePath(importPath, fromFile);

    for (const ext of extensions) {
      try {
        await readFile(basePath + ext, 'utf-8');
        return true;
      } catch {
        continue;
      }
    }

    try {
      await readFile(basePath + '/index.ts', 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private resolveRelativePath(importPath: string, fromFile: string): string {
    const parts = fromFile.split('/');
    parts.pop();

    const importParts = importPath.split('/');

    for (const part of importParts) {
      if (part === '..') {
        parts.pop();
      } else if (part !== '.') {
        parts.push(part);
      }
    }

    return parts.join('/');
  }
}
