/**
 * KLYN AI OS - Code Validator
 * AST-based syntax validation
 */

import { parse } from '@babel/parser';
import type { ParseResult } from '@babel/parser';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  ast?: any;
}

export interface ValidationError {
  message: string;
  line: number;
  column: number;
  code?: string;
}

export class CodeValidator {
  [key: string]: any;
  /**
   * Validate TypeScript/JavaScript code
   */
  validate(code: string, filename = 'unknown.ts'): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    try {
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy'],
        sourceFilename: filename,
        errorRecovery: true,
      });

      // Additional semantic checks
      this.checkSemantics(code, warnings);

      return {
        valid: true,
        errors: [],
        warnings,
        ast,
      };
    } catch (error: any) {
      // Parse syntax errors
      if (error.loc) {
        errors.push({
          message: error.message,
          line: error.loc.line,
          column: error.loc.column,
          code: this.getLineContext(code, error.loc.line),
        });
      } else {
        errors.push({
          message: error.message,
          line: 0,
          column: 0,
        });
      }

      return {
        valid: false,
        errors,
        warnings,
      };
    }
  }

  /**
   * Quick syntax check (faster, less detailed)
   */
  quickCheck(code: string): boolean {
    try {
      parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });
      return true;
    } catch {
      return false;
    }
  }

  private checkSemantics(code: string, warnings: string[]): void {
    // Check for common issues
    if (code.includes('var ')) {
      warnings.push('Use of "var" detected. Consider using "let" or "const".');
    }

    if (code.includes('eval(')) {
      warnings.push('Use of "eval()" detected. This is a security risk.');
    }

    if (code.match(/console\.(log|error|warn)/g)?.length > 20) {
      warnings.push('Excessive console statements detected.');
    }
  }

  private getLineContext(code: string, lineNumber: number): string {
    const lines = code.split('\n');
    return lines[lineNumber - 1] || '';
  }
}
