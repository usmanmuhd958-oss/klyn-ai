/**
 * KLYN AI OS - Error Detection Engine
 * Pattern-based error recognition from runtime output
 */

import type { ErrorInfo } from '../0.kernel/types.ts';

export interface ErrorPattern {
  name: string;
  pattern: RegExp;
  severity: ErrorInfo['severity'];
  extractor: (match: RegExpMatchArray) => Partial<ErrorInfo>;
}

export class ErrorDetector {
  [key: string]: any;
  private patterns: ErrorPattern[] = [
    // Node.js errors
    {
      name: 'uncaught_exception',
      pattern: /Uncaught (\w+): (.+?)(?:\n|$)/,
      severity: 'critical',
      extractor: (match) => ({
        type: match[1],
        message: match[2],
      }),
    },
    {
      name: 'reference_error',
      pattern: /ReferenceError: (.+?) is not defined/,
      severity: 'high',
      extractor: (match) => ({
        type: 'ReferenceError',
        message: `${match[1]} is not defined`,
      }),
    },
    {
      name: 'syntax_error',
      pattern: /SyntaxError: (.+)/,
      severity: 'high',
      extractor: (match) => ({
        type: 'SyntaxError',
        message: match[1],
      }),
    },
    {
      name: 'type_error',
      pattern: /TypeError: (.+)/,
      severity: 'high',
      extractor: (match) => ({
        type: 'TypeError',
        message: match[1],
      }),
    },
    // Stack trace with file location
    {
      name: 'stack_trace',
      pattern: /at .+ \((.+):(\d+):(\d+)\)/,
      severity: 'medium',
      extractor: (match) => ({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
      }),
    },
    // Module not found
    {
      name: 'module_not_found',
      pattern: /Cannot find module '(.+)'/,
      severity: 'high',
      extractor: (match) => ({
        type: 'ModuleNotFoundError',
        message: `Cannot find module '${match[1]}'`,
      }),
    },
    // Promise rejection
    {
      name: 'unhandled_rejection',
      pattern: /UnhandledPromiseRejection(?:Warning)?:(.+)/,
      severity: 'high',
      extractor: (match) => ({
        type: 'UnhandledPromiseRejection',
        message: match[1].trim(),
      }),
    },
    // Assertion errors
    {
      name: 'assertion_error',
      pattern: /AssertionError \[ERR_ASSERTION\]: (.+)/,
      severity: 'medium',
      extractor: (match) => ({
        type: 'AssertionError',
        message: match[1],
      }),
    },
  ];

  /**
   * Detect errors in output text
   */
  detect(output: string): ErrorInfo[] {
    const errors: ErrorInfo[] = [];
    const lines = output.split('\n');

    for (const pattern of this.patterns) {
      const matches = output.matchAll(new RegExp(pattern.pattern, 'g'));

      for (const match of matches) {
        const extracted = pattern.extractor(match);
        
        const error: ErrorInfo = {
          type: extracted.type || pattern.name,
          message: extracted.message || match[0],
          severity: pattern.severity,
          ...extracted,
        };

        errors.push(error);
      }
    }

    return errors;
  }

  /**
   * Detect primary error (most severe)
   */
  detectPrimary(output: string): ErrorInfo | null {
    const errors = this.detect(output);
    if (errors.length === 0) return null;

    // Sort by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    errors.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return errors[0];
  }

  /**
   * Extract full stack trace
   */
  extractStackTrace(output: string): string {
    const lines = output.split('\n');
    const stackLines: string[] = [];
    let inStack = false;

    for (const line of lines) {
      if (line.includes('Error:') || line.includes('    at ')) {
        inStack = true;
      }

      if (inStack) {
        stackLines.push(line);

        // Stop at empty line after stack
        if (line.trim() === '' && stackLines.length > 0) {
          break;
        }
      }
    }

    return stackLines.join('\n');
  }

  /**
   * Check if output contains errors
   */
  hasErrors(output: string): boolean {
    return this.patterns.some(p => p.pattern.test(output));
  }
}
