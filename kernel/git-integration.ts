// ============================================================
// KLYN AI OS — Git Integration v1.0.0
//
// Provides kernel-level git awareness:
//   - Repository state (branch, commit, dirty status)
//   - Automatic commit of generated code
//   - Branch management for agent work
//   - Change detection for re-planning triggers
//   - Git log parsing for context injection
//   - Zero external dependencies (child_process only)
// ============================================================

'use strict';

const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');

// ─── GIT RUNNER ──────────────────────────────────────────────
function git(args, cwd, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        const proc = spawn('git', args, {
            cwd:   cwd || process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env:   {
                ...process.env,
                GIT_TERMINAL_PROMPT: '0',   // Never prompt
            },
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });

        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(
                    `git ${args.join(' ')} exited ${code}: ${stderr.trim()}`
                ));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`git spawn error: ${err.message}`));
        });
    });
}

// ─── GIT INTEGRATION ─────────────────────────────────────────
class GitIntegration {
  [key: string]: any;
    #repoDir;
    #logger;
    #lastCommit;
    #lastStatus;
    #watchTimer;
    #changeCallback;

    constructor(repoDir, logger, options: any = {}) {
        this.#repoDir         = repoDir;
        this.#logger          = logger;
        this.#lastCommit      = null;
        this.#lastStatus      = null;
        this.#watchTimer      = null;
        this.#changeCallback  = options.onChange || null;
    }

    // ── IS GIT REPO ───────────────────────────────────────────
    async isGitRepo() {
        try {
            await git(['rev-parse', '--git-dir'], this.#repoDir);
            return true;
        } catch (_) {
            return false;
        }
    }

    // ── INIT ──────────────────────────────────────────────────
    async initIfNeeded() {
        if (!(await this.isGitRepo())) {
            this.#logger?.info('Initializing git repository');
            await git(['init'], this.#repoDir);
            await git(['config', 'user.email', 'klyn-ai-os@localhost'], this.#repoDir);
            await git(['config', 'user.name', 'KLYN AI OS'], this.#repoDir);

            // Create .gitignore
            const gitignore = path.join(this.#repoDir, '.gitignore');
            if (!fs.existsSync(gitignore)) {
                fs.writeFileSync(gitignore, [
                    'node_modules/',
                    'runtime/logs/',
                    'runtime/metrics-store/',
                    'runtime/vault/',
                    'runtime/sessions/',
                    'runtime/snapshots/',
                    '*.pid',
                    '*.tmp',
                    '*.queue',
                    'llama.cpp/build/',
                    '*.gguf',
                ].join('\n'), 'utf8');
            }

            this.#logger?.info('Git repository initialized');
        }

        // Configure commit identity if not set
        try {
            await git(['config', 'user.email'], this.#repoDir);
        } catch (_) {
            await git(['config', 'user.email', 'klyn-ai-os@localhost'], this.#repoDir);
            await git(['config', 'user.name',  'KLYN AI OS'], this.#repoDir);
        }
    }

    // ── STATUS ────────────────────────────────────────────────
    async getStatus() {
        const [branch, commit, dirty, shortLog] = await Promise.all([
            this.#getBranch(),
            this.#getLastCommit(),
            this.#isDirty(),
            this.#getRecentLog(5),
        ]);

        this.#lastStatus = { branch, commit, dirty, recentLog: shortLog, ts: Date.now() };
        return this.#lastStatus;
    }

    async #getBranch() {
        try {
            return await git(['rev-parse', '--abbrev-ref', 'HEAD'], this.#repoDir);
        } catch (_) {
            return 'unknown';
        }
    }

    async #getLastCommit() {
        try {
            return await git(
                ['log', '-1', '--format=%H|%s|%an|%ar'],
                this.#repoDir
            );
        } catch (_) {
            return null;
        }
    }

    async #isDirty() {
        try {
            const status = await git(['status', '--porcelain'], this.#repoDir);
            return (status as any).length > 0;
        } catch (_) {
            return false;
        }
    }

    async #getRecentLog(n = 5) {
        try {
            const output = await git(
                ['log', `-${n}`, '--format=%h %s (%ar)'],
                this.#repoDir
            );
            // @ts-ignore
            return output.split('\n').filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    // ── COMMIT ────────────────────────────────────────────────
    async commitChanges(message, files = ['.']) {
        try {
            // Stage files
            await git(['add', ...files], this.#repoDir);

            // Check if there's anything to commit
            const staged = await git(
                ['diff', '--cached', '--name-only'],
                this.#repoDir
            );

            // @ts-ignore
            if (!staged.trim()) {
                this.#logger?.debug('Git: nothing to commit');
                return null;
            }

            // Commit
            const commitOut = await git(
                ['commit', '-m', message, '--no-verify'],
                this.#repoDir
            );

            // @ts-ignore
            const hash = commitOut.match(/\[[\w]+\s+([a-f0-9]+)\]/)?.[1] || 'unknown';

            this.#logger?.info(`Git commit: ${hash} — ${message}`);
            return hash;

        } catch (err) {
            this.#logger?.warn('Git commit failed', { error: err.message });
            return null;
        }
    }

    // ── AUTO-COMMIT GENERATED CODE ────────────────────────────
    async autoCommitGeneratedCode(agentId, description) {
        const message = `feat(${agentId}): ${description}

Generated by KLYN AI OS Agent: ${agentId}
Timestamp: ${new Date().toISOString()}
[skip ci]`;

        return this.#retry3(() => this.commitChanges(message));
    }

    // ── BRANCH MANAGEMENT ────────────────────────────────────
    async createAgentBranch(agentId) {
        const branchName = `klyn/${agentId}/${Date.now()}`;
        try {
            await git(['checkout', '-b', branchName], this.#repoDir);
            this.#logger?.info(`Git branch created: ${branchName}`);
            return branchName;
        } catch (err) {
            this.#logger?.warn('Git branch creation failed', { error: err.message });
            return null;
        }
    }

    async checkoutMain() {
        for (const branch of ['main', 'master', 'develop']) {
            try {
                await git(['checkout', branch], this.#repoDir);
                return branch;
            } catch (_) {}
        }
        return null;
    }

    // ── CHANGE WATCHER ───────────────────────────────────────
    startWatching(intervalMs = 30_000) {
        if (this.#watchTimer) return;

        this.#watchTimer = setInterval(async () => {
            try {
                const status = await this.getStatus();
                const commit = (status as any).commit;

                if (this.#lastCommit && commit !== this.#lastCommit) {
                    this.#logger?.info('Git: new commits detected', {
                        from: this.#lastCommit?.slice(0, 8),
                        to:   commit?.slice(0, 8),
                    });
                    this.#changeCallback?.({ from: this.#lastCommit, to: commit });
                }

                this.#lastCommit = commit;
            } catch (_) {}
        }, intervalMs);

        this.#watchTimer.unref?.();
    }

    stopWatching() {
        if (this.#watchTimer) {
            clearInterval(this.#watchTimer);
            this.#watchTimer = null;
        }
    }

    // ── DIFF ─────────────────────────────────────────────────
    async getDiff(file = null) {
        const args = ['diff', '--stat'];
        if (file) args.push(file);
        try {
            return await git(args, this.#repoDir);
        } catch (_) {
            return '';
        }
    }

    // ── RETRY HELPER ─────────────────────────────────────────
    async #retry3(fn) {
        for (let i = 0; i < 3; i++) {
            try {
                return await fn();
            } catch (err) {
                if (i === 2) throw err;
                await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
            }
        }
    }
}

module.exports = { GitIntegration };


export {};
