# KLYN Genesis V670 — Omniversal Runtime Architecture

The V670 runtime is the runtime-first operating core of KLYN AI OS. It is
**not** a prompt-driven IDE wrapper: it is a multi-plane runtime that owns
execution, memory, reality modeling, capability governance, prediction, and a
never-ending orchestration loop — with all inter-plane communication flowing
through an event bus and a sub-millisecond Unix domain socket transport.

Every component is anchored into a real KLYN layer. Nothing here is a stub.

## Component → Real Layer Map

| # | V670 Component | File | Wires into (real) |
|---|---|---|---|
| 1 | KlynOmniversalKernel | `components/KlynOmniversalKernel.ts` | composition root — all ten components |
| 2 | OmniversalRuntimeKernel | `components/OmniversalRuntimeKernel.ts` | `0.kernel/kernel.ts`, `0.kernel/bus.ts`, `kernel/task-queue.ts`, `kernel/logger.ts`, UDS transport |
| 3 | InfiniteRuntimeOrchestrator | `components/InfiniteRuntimeOrchestrator.ts` | the runtime loop — drains the SPSC ring → `orchestrator.dispatch` → fabric; heal via `kernel/backoff.ts` |
| 4 | UniversalExecutionFabric | `components/UniversalExecutionFabric.ts` | `2.body/runtime.ts` (TermuxRuntime), `2.body/executor.ts`, `2.body/supervisor.ts`, `1.bridge/src/kernel_bridge.ts` (Rust, optional) |
| 5 | RuntimeIntelligenceController | `components/RuntimeIntelligenceController.ts` | `1.brain/cognitive_router.ts`, `1.brain/agent_engine.ts`, `1.brain/scheduler.ts`, `1.brain/orchestrator.ts` (Hive), `1.brain/llm_gateway.ts` |
| 6 | OmniversalMemoryArchitecture | `components/OmniversalMemoryArchitecture.ts` | `3.memory/unified_memory.ts`, `1.brain/vector_store.ts`, `1.brain/memory.ts`, `native/kernel_core` (encrypted vault, optional) |
| 7 | AdaptiveRealityEngine | `components/AdaptiveRealityEngine.ts` | `world-model/reality/RealityEngine.ts`, `world-model/state/ProjectState.ts`, `world-model/graph/*` |
| 8 | CrossRealityRuntimeEngine | `components/CrossRealityRuntimeEngine.ts` | memory ↔ reality ↔ filesystem realm reconciliation (`node:fs`) |
| 9 | DynamicCapabilityRuntime | `components/DynamicCapabilityRuntime.ts` | `kernel/plugin-engine.ts`, typed capability registry + policy denylist |
| 10 | FutureRuntimeSimulator | `components/FutureRuntimeSimulator.ts` | `world-model/prediction/FutureSimulator.ts`, `world-model/graph/ImpactGraph.ts` |

## Runtime-First IPC

- **In-process**: `ipc/ipc-bus.ts` (V670Bus) — typed handlers, wildcard,
  request/reply correlation, ring-bounded history. Bridged into the 0.kernel
  `KernelEventBus` so system events (`runtime.execution.*`, `healing.*`,
  `system.health_check`) are visible to the whole OS.
- **Cross-process**: `ipc/uds-server.ts` + `ipc/uds-client.ts` — Unix domain
  sockets with length-prefixed JSON frames (`ipc/protocol.ts`), request/reply
  correlation, broadcast, heartbeats, and p50/p95/p99 latency instrumentation.
- **Dispatch**: `ipc/ring-buffer.ts` is the TS reference of the Rust heart's
  SPSC ring buffer (`0.kernel/src/ringbuf.rs`) — identical semantics, tested.

## Rust Heart (V1000 convergence)

- `0.kernel/src/ringbuf.rs` — atomic SPSC ring buffer (std atomics +
  `parking_lot`), unit-tested.
- `0.kernel/src/mmap_vector.rs` — memory-mapped f64 vector engine
  (`memmap2`), unit-tested, with cosine similarity.
- Both are registered in `0.kernel/src/lib.rs` and build inside the existing
  napi crate (`cargo test -p klyn_kernel_core`). The `1.bridge` KernelBridge
  (dlopen) remains the JS↔Rust path; the fabric uses it when the `.so` exists
  and degrades to pure JS execution otherwise.

> Note: the sandbox has no `cargo`, so the Rust modules were written against
> the crate's existing deps (`memmap2`, `parking_lot`, `napi`) and ship with
> `#[cfg(test)]` suites — run `cargo test` in `0.kernel/` on a Rust host.

## Boot Order (strict dependency)

```
omniversal-memory → adaptive-reality → dynamic-capability → universal-fabric
→ runtime-intelligence → future-simulator → cross-reality → infinite-orchestrator
```

## Stub Replacement (production-grade injection)

The V670 pass replaced every stub found in the real layers:

| File | Before | After |
|---|---|---|
| `3.memory/unified_memory.ts` | empty `store`/`retrieve` | TTL, LRU, tag index, JSON persistence |
| `world-model/prediction/FutureSimulator.ts` | empty file | OLS regression + smoothing + confidence bands + scenarios |
| `1.brain/vector_store.ts` | empty file | cosine-similarity store + hash embeddings + persistence |
| `1.brain/memory.ts` | `class Memory {}` | working memory + similarity recall |
| `1.brain/scheduler.ts` | `class Scheduler {}` | priority one-shot/interval scheduler |
| `1.brain/orchestrator.ts` | `class Hive {}` | multi-agent swarm with timeout isolation |
| `2.body/supervisor.ts` | `class Supervisor {}` | watchdog with retry/backoff + records |
| `0.kernel/kernel.ts` | console-log stub | typed runtime kernel on the event bus |

## Verification

```bash
npm run typecheck            # root project (must stay green)
npm run typecheck:v670       # V670 tree + every real module it wires into
npm run smoke:v670           # end-to-end runtime smoke test (bun)
cd 0.kernel && cargo test    # Rust heart unit tests (on a Rust host)
```

## Usage

```ts
import { bootV670 } from './genesis/v670/index.js';

const kernel = await bootV670({ config: { enableIpc: true, tickMs: 250 } });
const health = kernel.health();            // all module metrics
await kernel.fabric.executeCommand('ls', ['-la']);
await kernel.memory.store('k', { v: 1 }, { tags: ['example'] });
await kernel.shutdown();
```
