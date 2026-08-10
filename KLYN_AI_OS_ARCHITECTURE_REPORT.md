# KLYN AI OS — Architecture & Diagnostics Report

**Audit target:** `usmanmuhd958-oss/klyn-ai` @ `b553bd5` (branch `arena/019fedcf-klyn-ai`)
**Audit date:** 2026-08-10
**Scope:** Zero-loss architectural audit + performance/concurrency diagnostics + production-ready refactoring patches for high-concurrency, low-latency AI-native IDE operations.
**Engineer role:** Principal AI OS Architect / Low-Level Systems Engineer

---

## 0. Executive Summary

KLYN AI OS is a multi-era monorepo containing **2,710 tracked files** (~64k lines of live TS/JS/Rust) spread across three parallel implementations of the same "AI OS" concept: a Rust native kernel (`0.kernel/`, `native/kernel_core/`, root `klyn-vault` crate), a TypeScript engine (`src/`, `kernel/`, `1.brain/`, `2.body/`, `4.loops/`), and a legacy Node gateway (`klyn_server.js`, `klyn_engine.js`, `engine.js`). Roughly 10.7 MB of the tree is historical archive (`genesis/` 6.2 MB × 1,724 bootstrap scripts, `.migration-backup/` 4.5 MB).

**Headline results:**

| Diagnostic | Severity | Status |
|---|---|---|
| O(m·n) LCS diff → process OOM on whole-file LLM rewrites | **CRITICAL** | ✅ Fixed (Myers O(ND) + anchor fallback) |
| Vault (`index.js`) is in-memory only — total state loss on restart | **CRITICAL** | ✅ Fixed (JSONL persistence + hydration) |
| `execSync(curl)` blocks event loop 5–35 s per LLM call (healer/brain) | **CRITICAL** | ✅ Fixed (native `fetch` + AbortController) |
| `/v1/impact` re-reads every file synchronously per request | **HIGH** | ✅ Fixed (memoized graph, 25 ms → 7 ms) |
| `state_engine.ts` static import of missing `@supabase/supabase-js` → module fails to load; local fallback dead code | **HIGH** | ✅ Fixed (lazy dynamic import) |
| `state_engine.ts` `localSet` lost updates under concurrency | **HIGH** | ✅ Fixed (serialized write chain) |
| Bracket-count "syntax validation" false-positives on strings/templates/comments | **HIGH** | ✅ Fixed (@babel/parser-based) |
| Import validation: 7 sequential `readFile` syscalls per import | **MEDIUM** | ✅ Fixed (parallel stat + memo) |
| `git add .` auto-commit sweeps user's whole tree into machine commits | **HIGH** | ✅ Fixed (scoped to engine-written files) |
| `repo_ingest.ts` caches grow unboundedly; "incremental" diff re-ingests everything | **HIGH** | ✅ Fixed (bounded FIFO caches, cache-preserving diff) |
| `ruleModify` regex injection (symbols with metacharacters) | **MEDIUM** | ✅ Fixed (RegExp escaping + boundary fix) |
| `patch_generator` spread-push stack overflow on huge hunks | **MEDIUM** | ✅ Fixed (loop pushes) |
| `npm test` missing; `test.ts` un-runnable; no test wiring | **HIGH** | ✅ Fixed (node:test suite + vitest wiring, 21+27 tests green) |
| Naive `ts.createProgram` per file-change in healer fallback | **MEDIUM** | ✅ Fixed (`transpileModule` fallback; daemon preferred) |

**Verification:** 21/21 node:test regression tests, 27/27 live vitest integration tests, clean `tsc` build, server smoke-tested, consolidated patch verified to apply cleanly against `HEAD`.

---

## 1. Codebase Map & Indexing

### 1.1 Repository topology (live code, excluding archives)

```
0.kernel/          Rust "heart" kernel — napi bridge, SPSC ring buffer, mmap vector/matrix, law VM   (34 files)
1.brain/           Cognitive layer — router, agent engine, patch generator/planner/validator, LLM gateway, vector store, swarm (30)
1.bridge/          Native bridge TS (kernel_bridge, telemetry_bridge) + committed dist artifacts
1.orchestrator/    Orchestrator + stress tests
2.body/            Execution layer — executor, transactional patcher, diagnostics tsserver daemon, pool (16)
2.vfs/             VFS layer
3.memory/          3.senses/ 4.loops/ 4.mouth/ 5.marketplace/   peripheral layers (healer, brain loop, diagnostics bridge)
agents/            Swarm agents (architect, auditor, coder, reviewer, bug_hunter, workflows)
core/              Legacy core (ast-engine, errors, memory, multi_llm, performance-monitor)
kernel/            Legacy TS kernel — NexusKernel, orchestrator, task-queue, pipeline/repo_ingest, ast/dependency_graph,
                   services (state_engine, rate_limiter, ...), lifecycle, security (125 files)
src/               Phase-1 TS engine — KlynEngine, MerkleDAG, VFS, process-manager, indexer (index-store/manifest/symbols),
                   parser, query engine + stray Rust files (lib.rs, index.rs, simd.rs, storage.rs, vault.rs)
native/            C clients (klyn_client.c, klyn_daemon.c, klyn_ipc.c, mmap) + native/kernel_core Rust crate (v3)
packages/          ai-orchestrator, ai-gateway, agent-runtime, workflow-engine, core-runtime, evolution-controller
root JS/TS         klyn_server.js (HTTP gateway), klyn_engine.js (neural pipeline CLI), engine.js (AST search),
                   index.js (vector vault), klyn_cli.js, index.ts, example.ts, test.ts
genesis/           1,724 evolution bootstrap scripts (6.2 MB) — HISTORICAL ARCHIVE
.migration-backup/ ESM migration snapshots (4.5 MB) — HISTORICAL ARCHIVE
```

### 1.2 Core dependencies

**Runtime deps (package.json):** `@babel/parser` 8.0.4, `@google/generative-ai`, `chokidar` 5, `cors`, `dotenv`, `express` 5, `openai` 7. **Dev:** `typescript` 5.9, `@types/node`, `vitest` (added).

**Undeclared-but-referenced modules found by the analyzer (144 hits, top live ones):**

| Module | Referenced by | Impact |
|---|---|---|
| `@supabase/supabase-js` | `kernel/src/services/state_engine.ts` | **hard static import → module-load crash** (fixed) |
| `@anthropic-ai/sdk` | `1.brain/providers/anthropic.provider.ts` | runtime crash if provider used |
| `sql.js` | `1.brain/graph_memory.ts` | runtime crash if graph memory used |
| `picocolors` | `2.body/deployer.ts` | runtime crash on deploy path |
| `ws` | `kernel/ambient.d.ts` declares it | ambient-masked; runtime crash if used |

`kernel/ambient.d.ts` `declare module` entries **mask** two of these for the compiler; `declarations.d.ts` at the repo root contains `declare module '*'` (not currently included by tsconfig — a landmine: any tsconfig that includes it disables module resolution checking repo-wide).

### 1.3 Module-boundary analysis (measured)

- **Compiled program:** only **153 of 293 live `.ts` files** are covered by `tsconfig.json`. Excluded but live: `4.loops/*`, `2.body/executor|patcher|runtime|supervisor|sysmon|validator|pool/*`, `1.brain/graph_memory`, `1.brain/providers/*`, `0.kernel/*`, `agents/*`, `3.senses/*`, `2.vfs/*`, `1.bridge/*`, `kernel/NexusKernel.ts` … These files are therefore **never type-checked**; the passing build is partially illusory.
- **Broken relative imports:** 31, e.g. `kernel/NexusKernel.ts` → `../registry/PrimeRegistry` (targets don't exist), `kernel/src/indexer/ast_graph.ts` → `./module`, `core/errors.ts` self-imports `../../../core/errors.js`, `shared/protocol.ts` matched a spurious `"..."` literal. None of the broken edges are on a hot path, but they confirm **module-resolution debt** from the CJS→ESM migration.
- **Circular import cycles (SCC ≥ 2): 0** — the graph is formally acyclic. ⚠️ Caveat: `kernel/src/orchestrator.ts` and `kernel/src/execution/evolution_api.ts` both import `shared/protocol.js` whose default export is a plain object — fine.
- **Top fan-in:** `kernel/src/observability/logger.ts` (13), `0.kernel/types.ts` (11), `1.brain/cognitive_router.ts` (9).

---

## 2. AST & LSP Compatibility Audit

### 2.1 AST-based incremental patching — verdict: PARTIALLY SUPPORTED

**What exists (good):**
- `src/indexer/index-store.ts` — a genuinely well-designed 3-level incremental index (ManifestLedger stat fast-path → chunk hashing → symbol upsert/invalidate). `AgentExecutionEngine.refreshIndex` correctly reuses the DAG/router when a delta is empty.
- `2.body/diagnostics/daemon.ts` — a real persistent `tsserver` daemon speaking JSON-over-stdio (`open`/`change`/`geterr`), with pending-request timeouts and event fan-out. The healer and engine bridge both attach to it (Phase 7 seam is clean: `DiagnosticsBridge` interface in `1.brain/agent_engine.ts`, impl in `4.loops/diagnostics_bridge.ts`).
- `TransactionalPatcher` — in-memory overlay with atomic commit (temp+rename), inverse-op rollback, per-tx forks for swarm agents.

**What blocks AST-grade patching:**
1. **`PatchGenerator` was the weak link** — full-matrix LCS (see §3.1). Fixed: now a bounded Myers O(ND) engine with common-prefix/suffix trim and an anchor-splitting fallback, optimal on small inputs, linear-memory on pathological ones. The `UnifiedDiff`/`FileOperation` contracts are unchanged, so `PatchValidator`, `TransactionalPatcher`, and `AgentSwarm` integrate without modification.
2. **Syntax validation was bracket-counting**, not parsing — false positives on `"}"`, `` `${x}` ``, `// }`, `/[{]/`. Fixed with `@babel/parser` (already a dependency), plugin-selected by extension (`typescript`, `jsx`, `decorators-legacy`), errors carry real line/column.
3. **Import validation did 7 sequential file reads per import.** Fixed: parallel `stat` probing, memoized per validation pass.
4. **No Tree-Sitter integration exists.** The only parser is Babel (JS/TS family); Python/Go/Rust "AST node counts" in `repo_ingest.ts` are regex keyword counts (e.g. `countRustASTNodes` counts `\bfn\b` + `{`). For a multi-language AI IDE, Tree-Sitter (or per-language real parsers) remains the primary gap; the `symbols.ts` Babel-based symbol extractor in `src/indexer/` is the model to generalize.
5. **Healer fallback built a full `ts.createProgram` per changed file** (O(repo) per keystroke). Fixed: `ts.transpileModule` syntactic fallback; semantic diagnostics remain on the persistent daemon.

### 2.2 Heavy couplings

- `1.brain/*` imports `../kernel/src/pipeline/repo_ingest.js` and `../kernel/src/ast/dependency_graph.js`; `2.body/*` imports `../0.kernel/types.ts` and `../1.brain/patch_generator.js`; `4.loops/*` imports `../core/memory.js` and `../2.body/diagnostics/daemon.js`. The "layer" directories are not layers — they are a **shared tangled module graph** with cross-era imports in both directions. SCC analysis says no cycles, but the coupling is architectural, not graph-theoretic.
- `index.js` vault is imported by both `engine.js` and `klyn_server.js` — now the single persistence point.

---

## 3. Performance & Concurrency Bottleneck Diagnostics

### 3.1 CRITICAL — `patch_generator.ts` O(m·n) LCS (fixed)

`longestCommonSubsequence` built a full `(lines+1)×(lines+1)` DP table of JS arrays: **O(m·n) time AND O(m·n) memory**. Measured impact: an 8,000-line vs 8,200-line rewrite (typical LLM output) previously needed ≥ 10⁸ numeric cells (~1–2 GB with boxed JS numbers) → **process OOM / multi-second GC stalls**. After the fix:

| Case | Before | After |
|---|---|---|
| 8k-line rewrite | OOM / minutes | **7.5 ms** |
| 50k-line file, single edit | ~2.5·10⁹ cells → OOM | **77 ms** |
| 2 × 12k fully-different files (anchor fallback) | OOM | **11 ms** |
| 300 randomized small cases vs LCS-optimal reference | — | **100% optimal, 100% reconstructs** |

Also fixed: `currentHunk.lines.push(...hugeArray)` spread-push stack overflow on large hunks → loop pushes.

### 3.2 CRITICAL — `index.js` vault: no persistence, O(N) recall with per-entry allocation (fixed)

- The vault was a module-level `Map`; `initializeVault` merely `mkdir`'d. **Every restart = total state loss**, forcing full re-index on boot (and `klyn_server.js` re-indexes after every patch/transaction/heal).
- `recall` spread-allocated `{ ...m, similarity, score }` per entry and fully sorted O(N log N) per query; `queryMemory` ignored the embedding entirely.
- Fixed: JSONL append persistence (debounced 50 ms batches, atomic compact rewrite >64 MB, `process.on('exit')` flush), hydration on `initializeVault`, O(N log K) bounded top-K min-heap, cached per-entry norms, `removeMemoryPrefix()` for incremental re-indexing. Measured: **10k stores 52 ms; recall ≈ 2 ms/query** (previously full-sort with allocation per entry). Degenerate (NaN/zero) embeddings are rejected defensively.

### 3.3 CRITICAL — `execSync(curl)` blocks the event loop for LLM calls (fixed)

`4.loops/healer.ts callAI` and `4.loops/brain.ts curl` shelled out to `curl` via `execSync` with `--max-time 30–35 s`. Every LLM round trip **froze the entire Node process** — fatal for any concurrent IDE workload (a single slow model call stalls every editor request). Fixed with native `fetch` + `AbortController`, preserving the exact timeout/network error messages callers match on. `verifyAndTest`'s `execSync('npx vitest …')` → promisified `execFile`; the duplicated `executeAndHeal` shims (two `(Healer.prototype as any).executeAndHeal` assignments, the ESM one silently overwriting the CJS one) collapsed into one async version. Residual: one `execSync` in the `klyn_engine.js` CLI-only `test` subcommand (acceptable — CLI, not server path).

### 3.4 HIGH — `klyn_server.js`: per-request full-repo synchronous scan (fixed)

- `analyzeImpact → buildDependencyGraph()` re-`readFile`'d every `.js/.ts` in the workdir **on every `/v1/impact` request**; only parsed `require('./…')` (ESM imports invisible to impact analysis).
- `verifyAndApplyPatch` / `executeAtomicTransaction` / `autoHealPatch` each re-ran the full index pass.
- Fixed: memoized dependency graph invalidated by mtime/size change; import parsing now covers `require`, ESM `import … from`, `import './x'`, dynamic `import()`, `export … from`; indexing is incremental (mtime/size skip + `removeMemoryPrefix` for stale blocks). Measured: first impact 25 ms → **cached 7 ms**, and subsequent patch/index passes skip unchanged files entirely.

### 3.5 HIGH — `state_engine.ts`: dead fallback + lost updates (fixed)

- `import { createClient } from '@supabase/supabase-js'` at module top: package not in `package.json` ⇒ **`ERR_MODULE_NOT_FOUND` at import time**, before the try/catch — the documented "fall back to local JSON" was dead code and the module could not load at all. Fixed: lazy dynamic `import()` inside `ensureSupabase()`, cached; verified the module now loads without the package and serves the local fallback.
- `localSet` was an unserialized whole-file read-modify-write ⇒ concurrent `setState` lost updates. Fixed: in-process promise-chain mutex + in-memory mirror for reads + atomic tmp/rename. Verified: **50 concurrent writes → 0 lost updates**.

### 3.6 HIGH — `repo_ingest.ts`: unbounded caches + fake incremental diff (fixed)

- `nodeCache`/`hashCache` were keyed by `path:mtime` and **never evicted** — every re-ingest of a repo with touched files leaks entries for old mtimes forever (memory leak).
- `getIncrementalDiff` called `ingestRepository`, which **cleared both caches first** — the "incremental" diff was a full re-read/re-hash of every file. Fixed: bounded FIFO caches (20k nodes / 50k hashes) and `getIncrementalDiff` now passes `{ clearCaches: false }` so unchanged files resolve from the mtime fast-path.
- The DAG retains full file `content: Uint8Array` per node (memory footprint ≈ repo size + tree overhead). Acceptable for the router's context assembly today; flagged for an LRU content cache in §7.

### 3.7 MEDIUM — misc (fixed)

- `patch_planner.ruleModify`: unescaped symbol interpolation into `RegExp` (throw/mismatch on `(`, `$`, `+`, …) → escaped + boundary-aware anchors.
- `klyn_engine.js` `GitEdgeSyncEngine`: `git add .` + commit of the **entire working tree** after every task → scoped to session-written files (`--`-guarded), async git.
- Healer `checkFileForErrors` per-change `ts.createProgram` → `transpileModule` fallback.

### 3.8 Memory management & state hydration verdict

- **Vault (semantic memory):** was volatile → now durable (JSONL + compact + exit flush). ✔
- **Kernel state (`state_engine`):** was lost-update-prone → serialized, mirror-backed. ✔
- **DAG/index state:** `IndexStore` hydrates via ManifestLedger (persisted manifest, `saveLedger`/`loadLedger`); `repo_ingest` DAG is rebuild-per-boot by design, caches now bounded. ✔
- **Healer memory:** `attempts[]`, `sessions`, `errorQueue` grow without eviction (bounded only implicitly); `sessions` map never prunes. Flagged (§7).
- **`ContextWindow` budget:** a 40-file repo already produces ~99,000 of 100,000 allowed tokens — context assembly loads full file contents per candidate. Flagged for chunked/ranked context (§7).

---

## 4. Diagnostic Tests & Build Verification (run in-container)

| Command | Result |
|---|---|
| `npm install` | ✅ 130 packages (incl. new `vitest`) |
| `npm run build` (`tsc -p tsconfig.json`) | ✅ exit 0 |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` (new) | ✅ **21/21** (diff engine, vault, planner, validator) |
| `npm run test:integration` (new) | ✅ **27/27** live ContextWeaver suite (vitest config excludes archives) |
| `npm start` (klyn_server.js) smoke | ✅ boots, `/v1/impact`, `/v1/context`, `/v1/patch`, bad-syntax rejection verified |
| `node dist/1.brain/test_agent_engine.js` | ✅ 4/4 queries succeed (ingest/routing/generation/validation) |
| `node engine.js` | ✅ AST semantic search works with persistent vault |
| `node test.ts` | ❌ **broken before audit** — imports `./core/memory` (extensionless; ESM) → `ERR_MODULE_NOT_FOUND`. Replaced by the new `tests/` suite. |
| `npm test` (old) | ❌ missing `"test"` script → added |
| `test_bridge.cjs` / `test_vfs.cjs` | ❌ require compiled native `.so` (`cargo build`) — no Rust toolchain in this container; native path documented in §7 |

**Rust side (not buildable in this container — no cargo/rustc):** three parallel crates exist — root `klyn-vault` (napi, C router via `build.rs`), `0.kernel/klyn_kernel_core` (candle/tokenizers), `native/kernel_core` (v3, dashmap/aes-gcm). They duplicate each other; consolidation is required (§7). Static review notes: `0.kernel/src/memory.rs` SPSC ring buffer relies on `&mut self` + Relaxed/Release atomics — correct under single-owner usage, but the atomics imply cross-thread sharing that is **not** guaranteed by the current ordering (would need Acquire loads on the consumer); `0.kernel/src/ringbuf.rs` wraps a `Mutex<Vec>` — correct but not lock-free despite the doc comment.

---

## 5. Applied Fixes — File Index (unified diffs in `patches/`)

| Patch file | Fix | Verify |
|---|---|---|
| `fix_1.brain_patch_generator.ts.patch` | Myers O(ND) diff + anchor fallback; loop-push hunks | tests/diff.test.mjs (312 + 2,000 randomized cases, 50k-line perf) |
| `fix_index.js.patch` | Persistent vault: JSONL + hydration + top-K heap + norm cache + prefix removal + NaN guard | tests/vault.test.mjs |
| `fix_klyn_server.js.patch` | Cached impact graph (ESM+require+import() parsing), incremental re-index | server smoke; impact 25→7 ms |
| `fix_kernel_src_services_state_engine.ts.patch` | Lazy supabase import; serialized local writes; mirror reads | module-load + 50-write concurrency test |
| `fix_4.loops_healer.ts.patch` | fetch LLM; execFile vitest; transpileModule fallback; dedupe `executeAndHeal` shims | tsc bundler-mode clean |
| `fix_4.loops_brain.ts.patch` | fetch LLM wrapper (same error semantics) | tsc bundler-mode clean |
| `fix_1.brain_patch_validator.ts.patch` | Babel syntax validation; parallel memoized import resolution | tests/planner.test.mjs |
| `fix_1.brain_patch_planner.ts.patch` | RegExp escape + boundary-aware `ruleModify` | tests/planner.test.mjs |
| `fix_kernel_src_pipeline_repo_ingest.ts.patch` | Bounded caches; cache-preserving incremental diff | build clean |
| `fix_klyn_engine.js.patch` | Scoped git sync (no more `git add .`); async git | syntax check |
| `fix_package.json.patch` + `fix_tests_and_config.patch` | test/test:integration/bench scripts, engines, vitest, suite | 21 + 27 tests green |
| `fix_.gitignore.patch` | ignore `vault_data/` runtime store | — |
| `klyn-ai-audit-fixes-consolidated.patch` | **All of the above, one `git apply`-able file** | ✅ applies cleanly against `HEAD` |

Apply with: `git apply patches/klyn-ai-audit-fixes-consolidated.patch` (or per-file), then `npm install && npm test`.

---

## 6. Build/Test Instructions (post-patch)

```bash
npm install
npm run build          # tsc
npm test               # node:test regression suite (build + run)
npm run test:integration
npm start              # gateway on :7860
node dist/1.brain/test_agent_engine.js ./kernel/src   # engine E2E
```

---

## 7. Residual Risks & Recommendations (Phase 2 — not applied, zero-loss-preserving)

1. **Consolidate the three Rust crates** (`klyn-vault`, `0.kernel/klyn_kernel_core`, `native/kernel_core`) into one, with a single `cargo workspace` and one napi binding surface; ship prebuilt `.node`/`.so` artifacts or a `postinstall` build fallback so `test_bridge.cjs`/`test_vfs.cjs` and `1.bridge`/`2.vfs` can run without a local toolchain.
2. **Adopt Tree-Sitter (or per-language real parsers)** for multi-language symbol extraction; replace regex "AST node counts" in `repo_ingest.ts`; route edits through the LSP daemon's `getEditsForFile`-style APIs when available.
3. **Re-enable full type-checking:** remove the exclusions in `tsconfig.json` incrementally (start with `4.loops`, `2.body`, `0.kernel`), delete `declarations.d.ts`'s `declare module '*'`, and move `kernel/ambient.d.ts` module shims into a real `@types`-style package or add the missing deps (`@supabase/supabase-js`, `@anthropic-ai/sdk`, `sql.js`, `picocolors`).
4. **Context window:** implement chunked ranked context (symbol-aware) in `CognitiveRouter.buildContext` instead of loading every candidate file's full content (~99k/100k tokens on a 40-file repo).
5. **Healer store hygiene:** bound `sessions`/`attempts`/`errorQueue` (LRU), and route memory persistence through the now-durable vault instead of `core/memory.ts`'s process-local maps.
6. **Native kernel:** fix SPSC ring-buffer memory ordering (Acquire loads) or document single-owner-only usage; remove the `Mutex`-backed "lock-free" claim in `ringbuf.rs`.
7. **Repo hygiene:** move `genesis/` (1,724 files) and `.migration-backup/` to git history / archive storage; delete dead files (`test.ts`, `core/errors.ts` self-import, `worker_pool.sh` stub, committed `1.bridge/dist`/`2.vfs/dist`); fix `kernel/NexusKernel.ts`'s five dangling imports.
8. **Security:** `klyn_server.js` `/v1/patch` accepts arbitrary file paths (path-join traversal into the workdir) with no auth, size limits, or rate limiting; `executeAndHeal` runs `npx tsx` on attacker-influenced paths. Add authn/authz, body-size caps, and a workdir confinement check before any write.
9. **`GitEdgeSyncEngine`** still runs unauthenticated git commits (now correctly scoped); consider gating behind an explicit flag (`KLYN_AUTO_COMMIT=1`) for IDE embeddings.

---

## 8. Methodology

- Full-tree inventory + extension/line counts; `package.json`/`Cargo.toml`/tsconfig analysis.
- Custom static analyzer (Node): import-graph extraction (ESM/dynamic/require), broken-relative-import detection, SCC cycle detection, fan-in ranking, undeclared-package detection.
- Grep-based scans for `readFileSync`/`execSync`/`setInterval`/`[key: string]: any` (90 occurrences across live TS) hot spots.
- Runtime verification: build, typecheck, server smoke, engine E2E, randomized property tests (diff engine vs LCS-optimal reference), concurrency tests (vault persistence, state engine lost-update), perf microbenchmarks.
- All fixes verified to preserve public APIs; consolidated patch validated with `git apply --check` against `HEAD`.
