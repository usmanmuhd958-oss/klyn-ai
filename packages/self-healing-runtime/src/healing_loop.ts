// =============================================================================
// KLYN AI OS — self-healing-runtime — Autonomous Mutation & Self-Healing Loop
// File: packages/self-healing-runtime/src/healing_loop.ts
//
// When a patch fails validation (syntax, quality gate) or its verification
// step fails, the loop retries with the ERROR TRACE and AST DIFF HINTS from
// the failed attempt injected directly into the next candidate's context.
//   - max 3 iterations (deterministic convergence bound)
//   - candidate patches are validated in memory before any disk write
//   - once applied, verification runs against the real file; on failure the
//     file is rolled back to the EXACT original content (deterministic)
//   - after max iterations without convergence the original is restored and
//     the failure returned with the full trace
// =============================================================================
import { readFile } from 'node:fs/promises';
import { TransactionalPatcher } from '../../../2.body/transactional_patcher.js';
import { analyzeFile } from '../../../src/indexer/symbols.js';
import { InlinePatchValidator } from './patch_validator.js';

export type AstHintType = 'symbol_added' | 'symbol_removed' | 'symbol_changed';

export interface AstDiffHint {
  type: AstHintType;
  symbol: string;
}

export interface HealingIterationContext {
  iteration: number;
  originalCode: string;
  /** Error trace that triggered the heal (may be empty for proactive heals). */
  errorTrace?: string;
  /** Candidate that failed the previous iteration (absent on iteration 1). */
  lastCandidate?: string;
  /** Validation / verification errors from the previous iteration. */
  lastErrors: string[];
  /** Structural hints: what the previous candidate changed vs the original. */
  astHints: AstDiffHint[];
}

export interface HealingOutcome {
  success: boolean;
  iterations: number;
  /** True when a candidate was written to disk. */
  applied: boolean;
  /** True when the file was restored to its original content. */
  rolledBack: boolean;
  finalContent?: string;
  errors: string[];
  hints: AstDiffHint[];
}

export interface HealOptions {
  filePath: string;
  originalCode: string;
  errorTrace?: string;
  /** Convergence bound — deterministic rollback if exceeded (default 3). */
  maxIterations?: number;
  /** Produce the next candidate from the augmented context. */
  generateCandidate: (ctx: HealingIterationContext) => string | Promise<string>;
  /** Optional post-apply verification (e.g. run tests). Errors here retry. */
  verify?: (content: string) => Promise<{ ok: boolean; errors: string[] }> | { ok: boolean; errors: string[] };
}

export class MutationLoop {
  private patcher: TransactionalPatcher;

  constructor(patcher?: TransactionalPatcher, private validator: InlinePatchValidator = new InlinePatchValidator()) {
    this.patcher = patcher ?? new TransactionalPatcher();
  }

  /** Deterministic convenience: try a fixed list of candidate patches in
   *  order, converge on the first that validates AND verifies. */
  async healWithPatches(
    filePath: string,
    originalCode: string,
    candidates: string[],
    options: { errorTrace?: string; verify?: HealOptions['verify'] } = {}
  ): Promise<HealingOutcome> {
    return this.heal({
      filePath,
      originalCode,
      errorTrace: options.errorTrace,
      verify: options.verify,
      generateCandidate: (ctx) => candidates[ctx.iteration - 1] ?? '',
    });
  }

  /** Full mutation loop (see module docs for the protocol). */
  async heal(options: HealOptions): Promise<HealingOutcome> {
    const maxIterations = options.maxIterations ?? 3;
    const errors: string[] = [];
    let hints: AstDiffHint[] = [];
    let applied = false;
    let lastCandidate: string | undefined;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const ctx: HealingIterationContext = {
        iteration,
        originalCode: options.originalCode,
        errorTrace: options.errorTrace,
        lastCandidate,
        lastErrors: errors,
        astHints: hints,
      };

      const candidate = await options.generateCandidate(ctx);
      if (typeof candidate !== 'string' || candidate.length === 0) {
        errors.push(`Iteration ${iteration}: candidate generator returned no code`);
        break;
      }
      lastCandidate = candidate;
      hints = computeAstHints(options.originalCode, candidate);

      // 1) In-memory validation — nothing touches disk until this passes.
      const report = this.validator.validate(candidate);
      if (!report.valid) {
        errors.push(...report.errors.map((e) => `Iteration ${iteration}: ${e}`));
        continue;
      }

      // 2) Atomic apply through the transactional patcher (single flush).
      const appliedResult = await this.applyCandidate(options.filePath, options.originalCode, candidate);
      if (!appliedResult.ok) {
        errors.push(`Iteration ${iteration}: apply failed — ${appliedResult.error}`);
        continue;
      }
      applied = true;

      // 3) Post-apply verification (tests / typecheck) against the real file.
      const verify = options.verify ?? (() => ({ ok: true, errors: [] as string[] }));
      const verdict = await verify(candidate);
      if (verdict.ok) {
        return {
          success: true,
          iterations: iteration,
          applied,
          rolledBack: false,
          finalContent: candidate,
          errors: [],
          hints,
        };
      }

      // 4) Verification failed — deterministic rollback to EXACT original.
      const rollback = await this.restore(options.filePath, candidate, options.originalCode);
      errors.push(...verdict.errors.map((e) => `Iteration ${iteration} verify: ${e}`));
      if (!rollback.ok) {
        errors.push(`Iteration ${iteration}: deterministic rollback failed — ${rollback.error}`);
        break; // never continue from an unrestored state
      }
      // Errors + hints are now carried into the next iteration's context.
    }

    // Not converged: guarantee the file is back to its original content.
    if (applied) {
      const disk = await readFile(options.filePath, 'utf-8').catch(() => null);
      if (disk !== null && disk !== options.originalCode) {
        await this.restore(options.filePath, disk, options.originalCode);
      }
    }

    return {
      success: false,
      iterations: maxIterations,
      applied,
      rolledBack: true,
      errors,
      hints,
    };
  }

  get committedCount(): number {
    return this.patcher.committed;
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private async applyCandidate(filePath: string, originalCode: string, candidate: string): Promise<{ ok: boolean; error?: string }> {
    const tx = this.patcher.begin();
    try {
      await this.patcher.apply(tx, { type: 'modify', path: filePath, oldContent: originalCode, newContent: candidate });
    } catch (error) {
      this.patcher.abort(tx);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const result = await this.patcher.commit(tx);
    if (!result.success) {
      return { ok: false, error: result.errors.join('; ') };
    }
    return { ok: true };
  }

  /** Restore a file to `target` content given the current `current` content
   *  (both known — the inverse operation is exact, never a guess). */
  private async restore(filePath: string, current: string, target: string): Promise<{ ok: boolean; error?: string }> {
    const tx = this.patcher.begin();
    try {
      await this.patcher.apply(tx, { type: 'modify', path: filePath, oldContent: current, newContent: target });
    } catch (error) {
      this.patcher.abort(tx);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const result = await this.patcher.commit(tx);
    return result.success ? { ok: true } : { ok: false, error: result.errors.join('; ') };
  }
}

/**
 * Structural diff between two versions of a file, computed with the same
 * brace-aware analyzer the indexer uses: which symbols were added, removed,
 * or changed (same name, different fingerprint).
 */
export function computeAstHints(original: string, candidate: string): AstDiffHint[] {
  const hints: AstDiffHint[] = [];
  const before = analyzeFile(original, 'original.ts');
  const after = analyzeFile(candidate, 'candidate.ts');

  const byNameBefore = new Map<string, Set<string>>();
  for (const s of before.symbols) {
    const set = byNameBefore.get(s.name) ?? new Set<string>();
    set.add(s.fingerprint);
    byNameBefore.set(s.name, set);
  }
  const byNameAfter = new Map<string, Set<string>>();
  for (const s of after.symbols) {
    const set = byNameAfter.get(s.name) ?? new Set<string>();
    set.add(s.fingerprint);
    byNameAfter.set(s.name, set);
  }

  for (const [name, fingerprints] of byNameAfter) {
    if (!byNameBefore.has(name)) {
      hints.push({ type: 'symbol_added', symbol: name });
    } else {
      const beforeFps = byNameBefore.get(name)!;
      const changed = Array.from(fingerprints).some((fp) => !beforeFps.has(fp));
      if (changed) hints.push({ type: 'symbol_changed', symbol: name });
    }
  }
  for (const name of byNameBefore.keys()) {
    if (!byNameAfter.has(name)) {
      hints.push({ type: 'symbol_removed', symbol: name });
    }
  }
  return hints;
}

export default MutationLoop;
