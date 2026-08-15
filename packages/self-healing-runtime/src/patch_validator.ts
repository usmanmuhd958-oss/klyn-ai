// =============================================================================
// KLYN AI OS — self-healing-runtime — Inline Patch Validator (Phase 3)
// File: packages/self-healing-runtime/src/patch_validator.ts
//
// Validates a candidate code patch BEFORE it ever touches disk:
//   1. fast structural check (brace/paren balance) + TypeScript syntax parse
//   2. unhandled-promise-rejection scan (the Phase 3 quality gate heuristic)
//   3. optional full projected-state compile through the in-memory virtual
//      TypeScript compiler host (zero disk writes — from 2.body/execution)
// =============================================================================
import * as ts from 'typescript';
import { compileProjection, type SpecDiagnostic } from '../../../2.body/execution/spec_exec.js';

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ProjectedValidationOptions {
  /** Base dir used to resolve tsconfig + sibling imports (default cwd). */
  repoRoot?: string;
}

/** Fast pre-filter: brace/paren balance across the whole patch. */
export function checkBalance(code: string): string[] {
  const errors: string[] = [];
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  let inStr: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '/') {
      if (code[i + 1] === '/') {
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }
      if (code[i + 1] === '*') {
        i += 2;
        while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i++;
        continue;
      }
    }
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  if (braces !== 0) errors.push(`Unbalanced braces: ${braces > 0 ? `${braces} unclosed` : `${-braces} unexpected`}`);
  if (parens !== 0) errors.push(`Unbalanced parentheses: ${parens > 0 ? `${parens} unclosed` : `${-parens} unexpected`}`);
  if (brackets !== 0) errors.push(`Unbalanced brackets: ${brackets > 0 ? `${brackets} unclosed` : `${-brackets} unexpected`}`);
  return errors;
}

/** TypeScript syntax diagnostics for a snippet (no program, no disk). */
export function syntaxDiagnostics(code: string): string[] {
  const result = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: 'inline-patch.ts',
  });
  const diagnostics = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/**
 * Structural scan for promise chains that can produce unhandled rejections:
 * a `.then(...)` chain with no `.catch(...)` / `.finally(...)` attached to the
 * same logical statement. Conservative by design — this is a gate heuristic,
 * not a proof; it only fires on clearly-observable chains.
 */
export function scanUnhandledRejections(code: string): string[] {
  const findings: string[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\.then\s*\(/.test(line)) continue;

    // Walk forward to the end of this logical statement: a line that ends
    // the chain (top-level ';' outside braces/strings at the same indent).
    const chain: string[] = [line];
    let j = i + 1;
    let indent = (line.match(/^\s*/) ?? [''])[0].length;
    while (j < lines.length) {
      const next = lines[j];
      chain.push(next);
      const nextIndent = (next.match(/^\s*/) ?? [''])[0].length;
      const trimmed = next.trim();
      const endsStatement = trimmed.endsWith(';') && nextIndent <= indent;
      j++;
      if (endsStatement && !trimmed.endsWith('.')) break;
      if (nextIndent <= indent && /^[})]/.test(trimmed)) break;
    }

    const chainText = chain.join('\n');
    if (/\.catch\s*\(/.test(chainText) || /\.finally\s*\(/.test(chainText)) continue;
    const chainStart = chain[0].trim().slice(0, 60);
    findings.push(`Unhandled promise rejection risk at line ${i + 1}: "${chainStart} ..." has no .catch()/.finally()`);
  }

  return findings;
}

export class InlinePatchValidator {
  /**
   * Validate a single-file patch: balance + syntax + rejection scan.
   * No disk I/O. Returns a report; `valid` is false when any error exists.
   */
  validate(code: string): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];

    errors.push(...checkBalance(code));
    if (errors.length === 0) {
      errors.push(...syntaxDiagnostics(code));
    }
    warnings.push(...scanUnhandledRejections(code));

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate a MULTI-FILE projected state through the virtual compiler host
   * (zero disk writes). Errors are reported per file; a `ProjectedOptions`
   * error is surfaced as a validation error so the mutation loop can retry
   * with the diagnostics injected into the next candidate's context.
   */
  async validateProjected(
    projected: Map<string, string>,
    options: ProjectedValidationOptions = {}
  ): Promise<ValidationReport> {
    const diagnostics: SpecDiagnostic[] = compileProjection(projected, options.repoRoot ?? process.cwd());
    const errors = diagnostics
      .filter((d) => d.category === 'error')
      .map((d) => `${d.file}:${d.line ?? '?'} — ${d.message}`);
    const warnings = diagnostics
      .filter((d) => d.category !== 'error')
      .map((d) => `${d.file}:${d.line ?? '?'} — ${d.message}`);
    return { valid: errors.length === 0, errors, warnings };
  }
}

export default InlinePatchValidator;
