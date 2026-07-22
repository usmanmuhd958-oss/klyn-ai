/**
 * KLYN AI OS - Diagnostic Generator
 * Creates comprehensive diagnostic payloads for healing
 */

import fs from 'fs/promises';
import path from 'path';
import { ErrorDetector } from './error_detector.ts';
import type { DiagnosticPayload, ErrorInfo, ExecutionResult } from '../0.kernel/types.ts';

export class DiagnosticGenerator {
  private errorDetector: ErrorDetector;

  constructor() {
    this.errorDetector = new ErrorDetector();
  }

  /**
   * Generate diagnostic from execution result
   */
  async generate(
    executionId: string,
    filePath: string,
    result: ExecutionResult
  ): Promise<DiagnosticPayload | null> {
    const errorOutput = result.stderr || result.stdout;

    // Detect errors
    const primaryError = this.errorDetector.detectPrimary(errorOutput);
    if (!primaryError) {
      return null;
    }

    // Extract full stack trace
    const stackTrace = this.errorDetector.extractStackTrace(errorOutput);

    // Read source code
    let sourceCode = '';
    try {
      sourceCode = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.warn(`[Diagnostics] Could not read source file: ${filePath}`);
    }

    // Get recent output lines
    const recentOutput = this.getRecentLines(errorOutput, 20);

    // Find related files from stack trace
    const relatedFiles = this.extractRelatedFiles(stackTrace, filePath);

    const diagnostic: DiagnosticPayload = {
      errorInfo: primaryError,
      context: {
        executionId,
        filePath,
        sourceCode,
        recentOutput,
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        },
      },
      stackTrace,
      relatedFiles,
      timestamp: new Date(),
    };

    return diagnostic;
  }

  /**
   * Enrich diagnostic with context
   */
  async enrichDiagnostic(diagnostic: DiagnosticPayload): Promise<DiagnosticPayload> {
    // Add error context (lines around error)
    if (diagnostic.errorInfo.line) {
      diagnostic.errorInfo.code = this.getErrorContext(
        diagnostic.context.sourceCode,
        diagnostic.errorInfo.line,
        3
      );
    }

    // Load related file contents
    if (diagnostic.relatedFiles) {
      for (const relatedFile of diagnostic.relatedFiles) {
        try {
          const content = await fs.readFile(relatedFile, 'utf-8');
          diagnostic.context.recentOutput.push(
            `\n--- Related file: ${relatedFile} ---\n${content.slice(0, 500)}`
          );
        } catch {}
      }
    }

    return diagnostic;
  }

  /**
   * Create human-readable diagnostic report
   */
  formatReport(diagnostic: DiagnosticPayload): string {
    const e = diagnostic.errorInfo;

    let report = `
╔══════════════════════════════════════════════════╗
║           ERROR DIAGNOSTIC REPORT                ║
╚══════════════════════════════════════════════════╝

🔴 Error Type: ${e.type}
📝 Message: ${e.message}
⚠️  Severity: ${e.severity.toUpperCase()}
📂 File: ${diagnostic.context.filePath}
${e.line ? `📍 Location: Line ${e.line}${e.column ? `, Column ${e.column}` : ''}` : ''}

${e.code ? `\n📄 Error Context:\n${e.code}\n` : ''}

📚 Stack Trace:
${diagnostic.stackTrace}

${diagnostic.relatedFiles?.length ? `\n🔗 Related Files:\n${diagnostic.relatedFiles.map(f => `  - ${f}`).join('\n')}` : ''}

⏰ Timestamp: ${diagnostic.timestamp.toISOString()}
    `.trim();

    return report;
  }

  private getRecentLines(output: string, count: number): string[] {
    return output.split('\n').slice(-count);
  }

  private extractRelatedFiles(stackTrace: string, mainFile: string): string[] {
    const files = new Set<string>();
    const filePattern = /at .+ \((.+?):\d+:\d+\)/g;

    let match;
    while ((match = filePattern.exec(stackTrace)) !== null) {
      const file = match[1];
      if (file !== mainFile && !file.includes('node_modules')) {
        files.add(file);
      }
    }

    return Array.from(files);
  }

  private getErrorContext(sourceCode: string, line: number, contextLines: number): string {
    const lines = sourceCode.split('\n');
    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);

    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? '>>>' : '   ';
        return `${marker} ${lineNum.toString().padStart(4)} | ${l}`;
      })
      .join('\n');
  }
}
