/**
 * diagnostics_bridge.ts - Wires the persistent LSP daemon into the agent
 * engine's delta-aware routing so heals trigger off real-time type errors.
 *
 * On every incremental IndexDelta the engine passes the touched files (plus
 * their DAG-affected dependents) to `diagnoseFiles`; error diagnostics are
 * converted to ErrorContexts and dispatched to the healer (or an injected
 * sink). The same daemon process is shared with the healer via
 * `healer.attachDaemon`, so its own watch flow uses one persistent tsserver.
 */
import { readFile } from 'node:fs/promises'
import type { AgentExecutionEngine, DiagnosticsBridge, DeltaDiagnostics } from '../1.brain/agent_engine.js'
import { TypeScriptServerDaemon, type DiagnosticEntry } from '../2.body/diagnostics/daemon.js'
import type { Healer, ErrorContext } from './healer.ts'

export interface DiagnosticsHealBridgeOptions {
  /** Working directory for tsserver (isolate from the host project). */
  cwd?: string
  /** Explicit tsserver path; defaults to the installed typescript bin. */
  tsServerPath?: string
  /** Override the heal sink (default: healer.enqueue). Useful in tests. */
  onHealContexts?: (contexts: ErrorContext[]) => void
  /** Cap files diagnosed per delta pass (default 64). */
  maxFilesPerPass?: number
}

export interface DiagnosticsHealBridgeStats {
  daemonReady: boolean
  filesDiagnosed: number
  errorsFound: number
  healsDispatched: number
}

const DEFAULT_MAX_FILES = 64

export class DiagnosticsHealBridge implements DiagnosticsBridge {
  private daemon: TypeScriptServerDaemon | null = null
  private daemonReady = false
  private healer: Healer | null = null
  private filesDiagnosed = 0
  private errorsFound = 0
  private healsDispatched = 0
  private readonly maxFilesPerPass: number
  private readonly onHealContexts: (contexts: ErrorContext[]) => void

  constructor(private options: DiagnosticsHealBridgeOptions = {}) {
    this.maxFilesPerPass = options.maxFilesPerPass ?? DEFAULT_MAX_FILES
    this.onHealContexts =
      options.onHealContexts ?? ((contexts) => this.healer?.enqueue(contexts))
  }

  /** Spawn the daemon and attach engine + healer to it. Returns false when
   *  tsserver is unavailable (the engine then runs without diagnostics). */
  async attach(engine: AgentExecutionEngine, healer: Healer): Promise<boolean> {
    this.healer = healer
    const daemon = new TypeScriptServerDaemon({
      cwd: this.options.cwd,
      tsServerPath: this.options.tsServerPath,
      log: () => undefined,
    })
    this.daemonReady = await daemon.start()
    this.daemon = daemon
    if (!this.daemonReady) return false
    healer.attachDaemon(daemon)
    engine.attachDiagnosticsBridge(this)
    return true
  }

  /** Diagnose the delta-touched files (incl. DAG-affected dependents). */
  async diagnoseFiles(files: string[]): Promise<DeltaDiagnostics[]> {
    if (!this.daemon || !this.daemonReady) {
      return files.map((file) => ({ file, diagnostics: [] }))
    }
    const results: DeltaDiagnostics[] = []
    for (const file of files.slice(0, this.maxFilesPerPass)) {
      try {
        const content = await readFile(file, 'utf-8')
        const diags = await this.daemon.getDiagnostics(file, content)
        this.filesDiagnosed++
        const mapped = diags.map((d) => ({
          category: d.category,
          code: d.code,
          message: d.message,
          line: d.start?.line ?? undefined,
        }))
        this.errorsFound += mapped.filter((d) => d.category === 'error').length
        results.push({ file, diagnostics: mapped })
      } catch {
        // unreadable files (deleted mid-pass) contribute no diagnostics
      }
    }
    return results
  }

  /** Dispatch error diagnostics to the heal sink as ErrorContexts. */
  onErrors(results: DeltaDiagnostics[]): void {
    const contexts: ErrorContext[] = []
    for (const result of results) {
      for (const d of result.diagnostics) {
        if (d.category !== 'error') continue
        contexts.push({
          filePath: result.file,
          errorMessage: d.message,
          errorType: categorizeDiagnostic(d.code, d.message),
          lineNumber: d.line ?? 1,
        })
      }
    }
    if (contexts.length === 0) return
    this.healsDispatched += contexts.length
    this.onHealContexts(contexts)
  }

  getStats(): DiagnosticsHealBridgeStats {
    return {
      daemonReady: this.daemonReady,
      filesDiagnosed: this.filesDiagnosed,
      errorsFound: this.errorsFound,
      healsDispatched: this.healsDispatched,
    }
  }

  async dispose(): Promise<void> {
    await this.daemon?.dispose()
    this.daemon = null
    this.daemonReady = false
  }
}

/** Map a TS diagnostic to the healer's error taxonomy by code family. */
function categorizeDiagnostic(code: number, message: string): ErrorContext['errorType'] {
  if (code >= 1000 && code < 2000) return 'syntax'
  if (code >= 2000 && code < 3000) return 'type'
  if (/syntax|parse/i.test(message)) return 'syntax'
  if (/type|assign|argument|property/i.test(message)) return 'type'
  return 'logic'
}

/** One-shot convenience: spawn the bridge and wire engine + healer. */
export async function attachDiagnosticsBridge(
  engine: AgentExecutionEngine,
  healer: Healer,
  options: DiagnosticsHealBridgeOptions = {}
): Promise<DiagnosticsHealBridge | null> {
  const bridge = new DiagnosticsHealBridge(options)
  const ok = await bridge.attach(engine, healer)
  return ok ? bridge : null
}

export default DiagnosticsHealBridge
