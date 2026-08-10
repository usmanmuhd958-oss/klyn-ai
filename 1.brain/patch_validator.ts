// 1.brain/patch_validator.ts
import type { UnifiedDiff, FileOperation } from './patch_generator.js';
import type { ASTDependencyGraph } from '../kernel/src/ast/dependency_graph.js';
import { readFile, stat } from 'node:fs/promises';
import { parse } from '@babel/parser';

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
  /** Per-pass memo for relative-import resolution (cleared per validateDiff). */
  private importResolutionCache = new Map<string, boolean>();

  constructor(private depGraph?: ASTDependencyGraph) {}

  async validateDiff(diff: UnifiedDiff, dryRun: boolean = true): Promise<ValidationResult> {
    this.importResolutionCache.clear();
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
    const ext = filePath.split('.').pop()?.toLowerCase();

    if (!ext || !['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
      return errors;
    }

    // AUDIT FIX: the previous check counted braces per character, which
    // false-positived on braces inside strings, template literals, comments
    // and regexes (rejecting valid LLM patches), and missed genuinely broken
    // code that happened to be brace-balanced. Use the real parser
    // (@babel/parser, already a dependency) with error positions.
    const plugins: any[] = [];
    if (ext === 'ts' || ext === 'tsx') plugins.push(['typescript', { dts: false }]);
    if (ext === 'tsx' || ext === 'jsx') plugins.push('jsx');
    plugins.push('decorators-legacy');

    try {
      parse(content, {
        sourceType: 'module',
        allowReturnOutsideFunction: true,
        errorRecovery: false,
        plugins,
      });
    } catch (error) {
      const err = error as { message?: string; loc?: { line?: number; column?: number } };
      const loc = err.loc;
      const message = (err.message || 'Syntax error').replace(/\s*\(\d+:\d+\)$/, '');
      errors.push({
        type: 'syntax',
        message,
        filePath,
        line: loc?.line,
      });
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
    // AUDIT FIX: the previous implementation probed up to 7 candidate paths
    // with SEQUENTIAL awaited reads per import statement — a 20-import file
    // cost 140+ serialized syscalls per validation pass. Candidates are now
    // probed in one parallel round and memoized per (fromFile, importPath).
    const cacheKey = `${fromFile}\u0000${importPath}`;
    const cached = this.importResolutionCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
    const basePath = this.resolveRelativePath(importPath, fromFile);
    const candidates = [
      ...extensions.map((ext) => basePath + ext),
      basePath + '/index.ts',
      basePath + '/index.js',
    ];

    const results = await Promise.all(
      candidates.map((candidate) => stat(candidate).then(() => true, () => false))
    );
    const resolved = results.some(Boolean);
    this.importResolutionCache.set(cacheKey, resolved);
    return resolved;
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
