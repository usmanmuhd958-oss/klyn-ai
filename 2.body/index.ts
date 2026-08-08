// @ts-ignore
export { TermuxRuntime } from './runtime.ts';
// @ts-ignore
export { CodePatcher } from './patcher.ts';
// @ts-ignore
export { CodeValidator } from './validator.ts';
// @ts-ignore
export { ProcessExecutor } from './executor.ts';
// @ts-ignore
export { ShellPool } from './pool/pool.ts';
// @ts-ignore
export { ShellSlot } from './pool/shell-slot.ts';
// @ts-ignore
export { CommandPlanCache } from './pool/plan-cache.ts';
// Phase 6: transactional multi-file mutation engine.
export { TransactionalPatcher, VirtualOverlay } from './transactional_patcher.js';
export type { Transaction, TransactionResult, OverlaySnapshot } from './transactional_patcher.js';
// Phase 7: persistent tsserver diagnostics daemon.
export { TypeScriptServerDaemon } from './diagnostics/daemon.js';
export type { DiagnosticEntry, DiagnosticSpan, DaemonOptions, DaemonStats } from './diagnostics/daemon.js';
// Phase 10: deep system telemetry (kernel-boundary process monitoring).
export { SystemMonitor, createSystemMonitor } from './sysmon.js';
export type { SystemEvent, SystemEventKind, SysmonOptions } from './sysmon.js';
export { TelemetryBridge, telemetryBridge } from '../1.bridge/src/telemetry_bridge.js';
export type { ProcessSample, ProcessExit } from '../1.bridge/src/telemetry_bridge.js';
