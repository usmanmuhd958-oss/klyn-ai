/**
 * =============================================================================
 * KLYN AI OS — 1.brain — Distributed Agent Swarm Consensus (Phase 9)
 * File: 1.brain/swarm/AgentSwarm.ts
 *
 * Four specialist agents operate CONCURRENTLY on private overlay forks:
 *
 *   Architect      — plans the atomic mutation (PatchPlanner, read-only).
 *   Code Modder    — applies the plan to its own fork (validates apply-ability).
 *   SecurityAuditor— applies the plan, compiles the projected state, votes
 *                    against any error diagnostics.
 *   TestGenerator  — applies the plan, adds a virtual smoke-import test, and
 *                    votes on the combined compile.
 *
 * Zero lock contention: every agent writes only to its own `fork()` overlay
 * (per-transaction overlays in TransactionalPatcher). The ONLY serialization
 * point is the coordinator's epoch merge → atomic commit (or inverse replay
 * rollback on a dissenting vote).
 * =============================================================================
 */
import { PatchPlanner, type PatchPlan, type ExecPlan } from '../patch_planner.js';
import { TransactionalPatcher } from '../../2.body/transactional_patcher.js';
import { compileProjection, type SpecDiagnostic } from '../../2.body/execution/spec_exec.js';
import type { RouteDecision } from '../cognitive_router.js';
import type { FileOperation } from '../patch_generator.js';
import { join, dirname, basename, isAbsolute } from 'node:path';

export type SwarmRole = 'architect' | 'modder' | 'auditor' | 'tester';

export interface SwarmVote {
  agent: string;
  role: SwarmRole;
  approved: boolean;
  reason: string;
}

export interface EpochOptions {
  /** Repo root for relative plan paths (default process.cwd()). */
  repoRoot?: string;
  /** Optional external diagnostics provider (e.g. LSP daemon-backed);
   *  defaults to the in-process virtual-host compiler. */
  diagnose?: (projected: Map<string, string>, repoRoot: string) => Promise<SpecDiagnostic[]>;
  /** Require the Tester's approval (default true). */
  requireTester?: boolean;
}

export interface EpochResult {
  success: boolean;
  committed: boolean;
  votes: SwarmVote[];
  filesWritten: string[];
  errors: string[];
  plan: PatchPlan | null;
}

const AGENT_NAMES: Record<SwarmRole, string> = {
  architect: 'Architect',
  modder: 'CodeModder',
  auditor: 'SecurityAuditor',
  tester: 'TestGenerator',
};

const TS_EXT = /\.(ts|tsx|mts|cts)$/;

export class AgentSwarm {
  private patcher: TransactionalPatcher;

  constructor(private planner: PatchPlanner, patcher?: TransactionalPatcher) {
    this.patcher = patcher ?? new TransactionalPatcher();
  }

  get patcherCounts(): { active: number; committed: number } {
    return { active: this.patcher.activeCount, committed: this.patcher.committed };
  }

  /** Run a consensus epoch over explicit operations (test-friendly). */
  async runEpochOps(operations: FileOperation[], query: string, options: EpochOptions = {}): Promise<EpochResult> {
    const plan = this.planner.planFromOperations(operations, query, 'modify');
    return this.consensus(plan, query, options);
  }

  /** Run a consensus epoch over a route decision (planner-driven). */
  async runEpoch(route: RouteDecision, query: string, options: EpochOptions = {}): Promise<EpochResult> {
    const plan = await this.planner.plan(route, query);
    return this.consensus(plan, query, options);
  }

  // -------------------------------------------------------------------------
  // INTERNAL — epoch consensus
  // -------------------------------------------------------------------------

  private async consensus(plan: PatchPlan, query: string, options: EpochOptions): Promise<EpochResult> {
    const repoRoot = options.repoRoot ?? process.cwd();
    const votes: SwarmVote[] = [];
    const errors: string[] = [];

    // 1. Architect — plan validity (read-only, no fork required).
    votes.push({
      agent: AGENT_NAMES.architect,
      role: 'architect',
      approved: plan.operations.length > 0,
      reason: plan.operations.length > 0 ? `${plan.operations.length} op(s), ${plan.files.length} file(s)` : 'empty plan',
    });
    if (plan.operations.length === 0) {
      return { success: false, committed: false, votes, filesWritten: [], errors: ['Architect produced an empty plan'], plan };
    }

    // 2. Epoch transaction + three private forks — agents run concurrently,
    //    each on its own overlay. No shared mutable state ⇒ no contention.
    const epochTx = this.patcher.begin();
    const roles: SwarmRole[] = ['modder', 'auditor', 'tester'];
    const forks = await Promise.all(roles.map(() => this.patcher.fork(epochTx)));

    const projected = PatchPlanner.project(plan, repoRoot);
    const diagnose = options.diagnose ?? (async (p: Map<string, string>, root: string) => compileProjection(p, root));

    const [modVote, audVote, tesVote] = await Promise.all([
      this.runModder(forks[0], plan),
      this.runAuditor(forks[1], plan, projected, repoRoot, diagnose),
      this.runTester(forks[2], plan, projected, repoRoot, diagnose),
    ]);
    votes.push(modVote, audVote, tesVote);

    const requireTester = options.requireTester ?? true;
    const approved = votes.every((v) => v.approved) && (!requireTester || votes.every((v) => v.role !== 'tester' || v.approved));

    if (!approved) {
      await this.patcher.rollback(epochTx);
      for (const fork of forks) this.patcher.abort(fork);
      errors.push(...votes.filter((v) => !v.approved).map((v) => `${v.agent}: ${v.reason}`));
      return { success: false, committed: false, votes, filesWritten: [], errors, plan };
    }

    // 3. Consensus reached — fold the approved forks into the epoch tx and
    //    commit atomically. Conflicts (overlay drift) abort the epoch.
    const { conflicts } = await this.patcher.merge(forks, epochTx);
    if (conflicts.length > 0) {
      await this.patcher.rollback(epochTx);
      for (const fork of forks) this.patcher.abort(fork);
      errors.push(...conflicts);
      return { success: false, committed: false, votes, filesWritten: [], errors, plan };
    }
    const result = await this.patcher.commit(epochTx);
    for (const fork of forks) this.patcher.abort(fork);
    return {
      success: result.success,
      committed: result.success,
      votes,
      filesWritten: result.filesWritten,
      errors: result.errors,
      plan,
    };
  }

  /** Code Modder: apply the plan to its private fork; conflicts → dissent. */
  private async runModder(fork: string, plan: PatchPlan): Promise<SwarmVote> {
    try {
      for (const op of plan.operations) {
        await this.patcher.apply(fork, op);
      }
      return { agent: AGENT_NAMES.modder, role: 'modder', approved: true, reason: 'applied cleanly' };
    } catch (error) {
      return {
        agent: AGENT_NAMES.modder,
        role: 'modder',
        approved: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Security Auditor: compile the projected state; any error → dissent. */
  private async runAuditor(
    fork: string,
    plan: PatchPlan,
    projected: Map<string, string>,
    repoRoot: string,
    diagnose: (p: Map<string, string>, root: string) => Promise<SpecDiagnostic[]>
  ): Promise<SwarmVote> {
    try {
      for (const op of plan.operations) await this.patcher.apply(fork, op);
      const diags = await diagnose(projected, repoRoot);
      const errors = diags.filter((d) => d.category === 'error');
      return {
        agent: AGENT_NAMES.auditor,
        role: 'auditor',
        approved: errors.length === 0,
        reason: errors.length === 0 ? 'projected state compiles clean' : `${errors.length} error(s): ${errors[0].message.slice(0, 120)}`,
      };
    } catch (error) {
      return {
        agent: AGENT_NAMES.auditor,
        role: 'auditor',
        approved: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Test Generator: compile the projection + a virtual smoke-import per
   *  projected module; any compile failure → dissent. Nothing is written. */
  private async runTester(
    fork: string,
    plan: PatchPlan,
    projected: Map<string, string>,
    repoRoot: string,
    diagnose: (p: Map<string, string>, root: string) => Promise<SpecDiagnostic[]>
  ): Promise<SwarmVote> {
    try {
      for (const op of plan.operations) await this.patcher.apply(fork, op);
      const tested = new Map(projected);
      let added = 0;
      for (const [absPath] of projected) {
        if (!TS_EXT.test(absPath)) continue;
        const dir = dirname(absPath);
        const moduleName = basename(absPath).replace(TS_EXT, '');
        const testPath = join(dir, `__swarm_${moduleName.replace(/\W+/g, '_')}.smoke.test.ts`);
        if (tested.has(testPath)) continue;
        const importSpec = isAbsolute(absPath)
          ? `./${basename(absPath).replace(TS_EXT, '')}.js`
          : absPath;
        tested.set(
          testPath,
          `import * as mod from '${importSpec.replace(/\\/g, '/')}';\nvoid mod; // swarm smoke import\n`
        );
        added++;
      }
      const diags = await diagnose(tested, repoRoot);
      const errors = diags.filter((d) => d.category === 'error');
      return {
        agent: AGENT_NAMES.tester,
        role: 'tester',
        approved: errors.length === 0,
        reason: errors.length === 0
          ? `${added} smoke import(s) compile`
          : `${errors.length} error(s): ${errors[0].message.slice(0, 120)}`,
      };
    } catch (error) {
      return {
        agent: AGENT_NAMES.tester,
        role: 'tester',
        approved: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export default AgentSwarm;
