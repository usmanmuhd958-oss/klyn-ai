// 1.brain/patch_planner.ts
import { createHash } from 'node:crypto';
import type { FileOperation, UnifiedDiff } from './patch_generator.js';
import { PatchGenerator } from './patch_generator.js';
import type { RouteDecision, QueryIntent } from './cognitive_router.js';

/**
 * Phase 6: transactional multi-file mutation planning.
 *
 * A PatchPlan is an atomic, ordered set of FileOperations plus their inverse
 * operations, so a TransactionalPatcher (2.body) can commit the plan to disk
 * in one flush or roll it back at zero cost (pure in-memory inverse edits).
 *
 * Planning is LLM-driven when an adapter is supplied (returns a JSON op list);
 * otherwise a deterministic rule-based plan is built from the RouteDecision —
 * the planner never depends on network availability.
 */
export interface PatchLLM {
  /** Adapter identifier (e.g. 'deepseek-v4' / 'llm-gateway'). */
  readonly id: string;
  complete(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

export interface PatchPlan {
  id: string;
  query: string;
  intentType: QueryIntent['type'];
  /** Ordered apply operations (create before modify-before-delete constraints
   *  are honored by the transaction layer). */
  operations: FileOperation[];
  /** Inverse of `operations`, reversed — replay for zero-cost rollback. */
  inverse: FileOperation[];
  files: string[];
  source: 'llm' | 'rule';
  createdAt: number;
}

export interface PlanOptions {
  maxFiles?: number;
}

const RULE_MAX_FILES = 8;

export class PatchPlanner {
  private generator: PatchGenerator;

  constructor(private llm: PatchLLM | null = null, generator?: PatchGenerator) {
    this.generator = generator ?? new PatchGenerator();
  }

  /**
   * Build an atomic plan for a route decision. Tries the LLM adapter first,
   * validates + sanitizes its output, and falls back to deterministic rules
   * on any failure (parse error, invalid ops, or no adapter).
   */
  async plan(route: RouteDecision, query: string, options: PlanOptions = {}): Promise<PatchPlan> {
    const maxFiles = options.maxFiles ?? RULE_MAX_FILES;
    const intentType = route.intent.type;

    if (this.llm) {
      try {
        const prompt = this.buildPrompt(route, query);
        const raw = await this.llm.complete(prompt, { temperature: 0.1, maxTokens: 4000 });
        const ops = this.parseLlmOperations(raw);
        if (ops.length > 0) {
          return this.finalize(ops, intentType, query, 'llm');
        }
      } catch {
        // fall through to the deterministic rule plan
      }
    }

    return this.rulePlan(route, query, intentType, maxFiles);
  }

  /** Wrap an explicit operation list into a validated atomic plan. */
  planFromOperations(operations: FileOperation[], query: string, intentType: QueryIntent['type'] = 'modify'): PatchPlan {
    return this.finalize(operations, intentType, query, 'rule');
  }

  /**
   * The inverse of a single operation — replaying inverses in reverse order
   * restores the exact pre-plan file state (zero-cost: pure string swaps).
   */
  static inverse(op: FileOperation): FileOperation {
    switch (op.type) {
      case 'create':
        return { type: 'delete', path: op.path, oldContent: op.content };
      case 'modify':
        return { type: 'modify', path: op.path, oldContent: op.newContent, newContent: op.oldContent };
      case 'delete':
        return { type: 'create', path: op.path, content: op.oldContent };
    }
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private finalize(operations: FileOperation[], intentType: QueryIntent['type'], query: string, source: 'llm' | 'rule'): PatchPlan {
    const ops = this.orderOperations(operations);
    const inverse = ops.map((op) => PatchPlanner.inverse(op)).reverse();
    const files = Array.from(new Set(ops.map((op) => op.path))).sort();
    return {
      id: createHash('sha256').update(`${query}|${files.join(',')}|${Date.now()}`).digest('hex').slice(0, 16),
      query,
      intentType,
      operations: ops,
      inverse,
      files,
      source,
      createdAt: Date.now(),
    };
  }

  /** Deterministic fallback: mirrors the engine's rule-based intent handling. */
  private rulePlan(route: RouteDecision, query: string, intentType: QueryIntent['type'], maxFiles: number): PatchPlan {
    const ops: FileOperation[] = [];

    switch (intentType) {
      case 'modify': {
        for (const file of route.context.relevantFiles.slice(0, maxFiles)) {
          const modified = this.ruleModify(file.content, route.intent.symbols);
          if (modified !== file.content) {
            ops.push({ type: 'modify', path: file.path, oldContent: file.content, newContent: modified });
          }
        }
        break;
      }
      case 'create': {
        for (const target of route.intent.targetFiles.slice(0, maxFiles)) {
          ops.push({ type: 'create', path: target, content: this.ruleCreate(target, route, query) });
        }
        break;
      }
      case 'delete': {
        for (const file of route.context.relevantFiles.slice(0, maxFiles)) {
          ops.push({ type: 'delete', path: file.path, oldContent: file.content });
        }
        break;
      }
      case 'refactor': {
        for (const file of route.context.relevantFiles.slice(0, maxFiles)) {
          const refactored = this.ruleRefactor(file.content);
          if (refactored !== file.content) {
            ops.push({ type: 'modify', path: file.path, oldContent: file.content, newContent: refactored });
          }
        }
        break;
      }
      default:
        break; // read/analyze produce no mutations
    }

    return this.finalize(ops, intentType, query, 'rule');
  }

  private ruleModify(content: string, symbols: string[]): string {
    let modified = content;
    for (const symbol of symbols) {
      modified = modified.replace(new RegExp(`\\b${symbol}\\b`, 'g'), `Updated${symbol}`);
    }
    return modified;
  }

  private ruleCreate(filePath: string, route: RouteDecision, query: string): string {
    const ext = filePath.split('.').pop() ?? '';
    if (ext === 'ts' || ext === 'tsx') {
      const fileName = filePath.split('/').pop()?.replace(/\.(ts|tsx)$/, '') || 'Module';
      const className = fileName.charAt(0).toUpperCase() + fileName.slice(1);
      const methods = route.intent.symbols.map((s) => `  ${s}(): void {\n    // auto-generated stub body\n  }`).join('\n');
      return `// Auto-generated by Klyn AI OS (PatchPlanner)\n// Query: ${query}\n\nexport class ${className} {\n  constructor() {}\n${methods}\n}\n`;
    }
    return `// Generated file: ${filePath}\n// Query: ${query}\n`;
  }

  private ruleRefactor(content: string): string {
    const lines = content.split('\n');
    const importLines = lines.filter((l) => l.trim().startsWith('import')).sort();
    const rest = lines.filter((l) => !l.trim().startsWith('import'));
    const out: string[] = [];
    let indent = 0;
    for (const line of rest) {
      const trimmed = line.trim();
      if (trimmed.endsWith('}')) indent = Math.max(0, indent - 1);
      out.push('  '.repeat(indent) + trimmed);
      if (trimmed.endsWith('{')) indent++;
    }
    return [...importLines, '', ...out].join('\n');
  }

  /**
   * Order operations so creates land before modifies and deletes last within
   * the same file — the transaction layer still validates every op against
   * the overlay, so this is a best-effort ordering, not a correctness crutch.
   */
  private orderOperations(ops: FileOperation[]): FileOperation[] {
    const rank = (op: FileOperation): number => (op.type === 'create' ? 0 : op.type === 'modify' ? 1 : 2);
    return [...ops].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  }

  private buildPrompt(route: RouteDecision, query: string): string {
    const files = route.context.relevantFiles
      .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 6000)}`)
      .join('\n');
    return [
      'You are the mutation planner for Klyn AI OS. Produce ONLY a JSON array of file operations.',
      'Operation shapes:',
      '  {"type":"create","path":"<abs>","content":"<text>"}',
      '  {"type":"modify","path":"<abs>","oldContent":"<exact current text>","newContent":"<text>"}',
      '  {"type":"delete","path":"<abs>","oldContent":"<exact current text>"}',
      `Intent: ${route.intent.type} (confidence ${route.intent.confidence.toFixed(2)})`,
      `Query: ${query}`,
      `Files: ${route.context.relevantFiles.map((f) => f.path).join(', ')}`,
      'Relevant context:',
      files,
      'Return the JSON array only.',
    ].join('\n');
  }

  /** Parse + sanitize an LLM op list; throws on any invalid member. */
  private parseLlmOperations(raw: string): FileOperation[] {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in LLM response');
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) throw new Error('LLM response is not an array');
    const ops: FileOperation[] = [];
    for (const item of parsed) {
      const op = item as Partial<FileOperation>;
      if (op?.type === 'create' && typeof op.path === 'string' && typeof op.content === 'string') {
        ops.push({ type: 'create', path: op.path, content: op.content });
      } else if (
        op?.type === 'modify' && typeof op.path === 'string' &&
        typeof op.oldContent === 'string' && typeof op.newContent === 'string'
      ) {
        ops.push({ type: 'modify', path: op.path, oldContent: op.oldContent, newContent: op.newContent });
      } else if (op?.type === 'delete' && typeof op.path === 'string' && typeof op.oldContent === 'string') {
        ops.push({ type: 'delete', path: op.path, oldContent: op.oldContent });
      } else {
        throw new Error(`Invalid LLM operation: ${JSON.stringify(item)}`);
      }
    }
    return ops;
  }
}

/** Export UnifiedDiff re-export for planner consumers. */
export type { UnifiedDiff };
export default PatchPlanner;
