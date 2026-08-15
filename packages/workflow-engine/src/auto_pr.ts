// =============================================================================
// KLYN AI OS — workflow-engine — Autonomous Git PR & Release Pipeline Synthesizer
// File: packages/workflow-engine/src/auto_pr.ts
//
// Phase 6 capability #3. An automated Git release workflow:
//
//   pipeline.stage(commit)          — ONLY verified, proof-carrying commits
//                                     enter staging (unverified → rejected).
//   pipeline.releaseGate()          — lock-free release check: no unverified
//                                     code ever merges into production.
//   pipeline.generateChangelog()    — deterministic semantic changelog from
//                                     conventional-commit messages.
//   pipeline.bumpVersion(current)   — semver bump (major/minor/patch) from
//                                     breaking/feat/fix signals.
//   pipeline.buildPr({ ... })       — formatted PR payload with a cryptographic
//                                     proof-attachment table.
//   pipeline.gitCommands(version)   — exact shell commands for tag/branch/push
//                                     (the caller executes them; this module is
//                                     side-effect-free and fully testable).
//
// Lock-free staging: the staged list is append-only and each `stage` call is
// one atomic push in the single-threaded event loop — no mutexes, exactly
// like the swarm's epoch counter. The release gate evaluates an immutable
// snapshot at gate time.
// =============================================================================

export type CommitType = 'feat' | 'fix' | 'refactor' | 'chore' | 'docs' | 'other';

export interface ProofAttachment {
  signature: string;
  merkleRoot: string;
  verifier: string;
}

export interface CommitRecord {
  /** Git commit hash (full or abbreviated). */
  hash: string;
  /** Conventional-commit message, e.g. "feat(router): cascade routing". */
  message: string;
  files: string[];
  /** True only after the self-healing loop verified the commit. */
  verified: boolean;
  /** Cryptographic proof attachment (from the ZK audit / Merkle trail). */
  proof?: ProofAttachment;
  at: number;
}

export interface ChangelogEntry {
  type: CommitType;
  scope?: string;
  description: string;
  hash: string;
}

export interface StageResult {
  staged: CommitRecord[];
  rejected: CommitRecord[];
}

export interface ReleaseVerdict {
  ok: boolean;
  reasons: string[];
  staged: number;
}

export interface PRPayload {
  title: string;
  base: string;
  head: string;
  body: string;
  commits: CommitRecord[];
  version?: string;
}

export interface PipelineOptions {
  /** Production branch — the release gate protects it (default 'main'). */
  productionBranch?: string;
  /** Release branch prefix (default 'release/'). */
  releasePrefix?: string;
}

const DEFAULT_PRODUCTION_BRANCH = 'main';

/** Deterministic conventional-commit parser. */
export function parseCommitMessage(message: string): { type: CommitType; scope?: string; breaking: boolean; description: string } {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(message.trim());
  if (!match) return { type: 'other', breaking: false, description: message.trim() };
  const [, rawType, scope, bang, description] = match;
  const type = (['feat', 'fix', 'refactor', 'chore', 'docs'].includes(rawType) ? rawType : 'other') as CommitType;
  const breaking = bang === '!' || /BREAKING CHANGE/i.test(message);
  return { type, scope, breaking, description };
}

/** Semver bump from a set of commits: breaking → major, feat → minor,
 *  otherwise patch. Deterministic and order-insensitive. */
export function bumpVersion(current: string, commits: CommitRecord[]): string {
  const parsed = commits.map((c) => parseCommitMessage(c.message));
  const breaking = parsed.some((p) => p.breaking);
  const feat = parsed.some((p) => p.type === 'feat');
  const parts = current.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  if (breaking) {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (feat) {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    parts[2] += 1;
  }
  return `v${parts[0]}.${parts[1]}.${parts[2]}`;
}

export class ReleasePipeline {
  private staged: CommitRecord[] = [];
  private readonly productionBranch: string;
  private readonly releasePrefix: string;

  constructor(options: PipelineOptions = {}) {
    this.productionBranch = options.productionBranch ?? DEFAULT_PRODUCTION_BRANCH;
    this.releasePrefix = options.releasePrefix ?? 'release/';
  }

  // -------------------------------------------------------------------------
  // LOCK-FREE STAGING
  // -------------------------------------------------------------------------

  /** Stage ONE commit — atomic push. Only VERIFIED commits enter staging;
   *  proof-less commits stage but are flagged by releaseGate (the gate is the
   *  authority on cryptographic proofs — a verified-but-unproven commit must
   *  never silently bypass it). */
  stage(commit: CommitRecord): StageResult {
    if (!commit.verified) {
      return { staged: [], rejected: [commit] };
    }
    this.staged.push({ ...commit, files: [...commit.files] });
    return { staged: [commit], rejected: [] };
  }

  /** Stage a batch; returns the rejected subset (deterministic order). */
  stageAll(commits: CommitRecord[]): StageResult {
    const rejected: CommitRecord[] = [];
    for (const commit of commits) {
      const result = this.stage(commit);
      rejected.push(...result.rejected);
    }
    return { staged: this.staged.map((c) => ({ ...c, files: [...c.files] })), rejected };
  }

  /** Immutable snapshot of staged commits. */
  stagedCommits(): CommitRecord[] {
    return this.staged.map((c) => ({ ...c, files: [...c.files], proof: c.proof ? { ...c.proof } : undefined }));
  }

  // -------------------------------------------------------------------------
  // RELEASE GATE (lock-free: evaluates an immutable snapshot)
  // -------------------------------------------------------------------------

  /** No unverified code ever merges into production: every staged commit must
   *  be verified AND carry a cryptographic proof. */
  releaseGate(): ReleaseVerdict {
    const reasons: string[] = [];
    const snapshot = this.stagedCommits();
    if (snapshot.length === 0) {
      return { ok: false, reasons: ['nothing staged for release'], staged: 0 };
    }
    for (const commit of snapshot) {
      if (!commit.verified) reasons.push(`commit ${commit.hash} is not verified`);
      if (!commit.proof) reasons.push(`commit ${commit.hash} carries no cryptographic proof`);
      if (commit.proof && !commit.proof.signature) reasons.push(`commit ${commit.hash} proof has no signature`);
    }
    return { ok: reasons.length === 0, reasons, staged: snapshot.length };
  }

  // -------------------------------------------------------------------------
  // CHANGELOG + VERSION + PR SYNTHESIS
  // -------------------------------------------------------------------------

  /** Deterministic semantic changelog grouped by conventional-commit type. */
  generateChangelog(): ChangelogEntry[] {
    const snapshot = this.stagedCommits();
    const entries = snapshot.map((c) => {
      const parsed = parseCommitMessage(c.message);
      return { type: parsed.type, scope: parsed.scope, description: parsed.description, hash: c.hash };
    });
    const order: CommitType[] = ['feat', 'fix', 'refactor', 'chore', 'docs', 'other'];
    return entries.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.hash.localeCompare(b.hash));
  }

  /** Build the formatted PR payload with cryptographic proof attachments. */
  buildPr(options: { title?: string; base?: string; head: string; version?: string }): PRPayload {
    const snapshot = this.stagedCommits();
    const changelog = this.generateChangelog();
    const lines: string[] = [];
    lines.push(`## ${options.title ?? 'Autonomous release'}`);
    lines.push('');
    lines.push('### Changelog');
    for (const entry of changelog) {
      lines.push(`- **${entry.type}**${entry.scope ? ` (${entry.scope})` : ''}: ${entry.description} (\`${entry.hash.slice(0, 7)}\`)`);
    }
    lines.push('');
    lines.push('### Cryptographic proof attachments');
    lines.push('');
    lines.push('| Commit | Message | Verified | Proof signature | Merkle root |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const commit of snapshot) {
      lines.push(
        `| \`${commit.hash.slice(0, 7)}\` | ${commit.message.replace(/\|/g, '\\|')} | ${commit.verified ? '✅' : '❌'} | \`${commit.proof?.signature.slice(0, 16) ?? 'NONE'}…\` | \`${commit.proof?.merkleRoot.slice(0, 16) ?? 'NONE'}…\` |`
      );
    }
    lines.push('');
    lines.push('> Generated by Klyn AI OS ReleasePipeline — no unverified code merges into production.');
    return {
      title: options.title ?? `Release ${options.version ?? 'next'}`,
      base: options.base ?? this.productionBranch,
      head: options.head,
      body: lines.join('\n'),
      commits: snapshot,
      version: options.version,
    };
  }

  /** Exact shell commands to tag, branch, and push the release (caller runs
   *  these — the pipeline stays side-effect-free). */
  gitCommands(version: string, head: string): string[] {
    const branch = `${this.releasePrefix}${version}`;
    return [
      `git checkout -b ${branch}`,
      `git tag ${version}`,
      `git push origin ${branch}`,
      `git push origin ${version}`,
      `git push origin HEAD:${branch} --force-with-lease`,
    ];
  }

  get stagingSize(): number {
    return this.staged.length;
  }
}

export default ReleasePipeline;
