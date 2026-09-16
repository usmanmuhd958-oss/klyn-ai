/**
 * =============================================================================
 * KLYN AI OS — World Model / Prediction — FutureSimulator
 * File: world-model/prediction/FutureSimulator.ts
 * Version: 2.1.0
 *
 * A deterministic, dependency-free forecasting engine used by the Genesis V670
 * FutureRuntimeSimulator. Provides:
 *   - Time-series forecast via ordinary least squares regression.
 *   - Exponential smoothing for noisy series.
 *   - Confidence bands (normal approximation) for uncertainty.
 *   - Monte-Carlo-free scenario simulation with explicit iteration functions.
 *   - Trend classification and anomaly detection.
 *   - PREDICTIVE LOOP (Phase 7): ingest change events, learn co-occurrence
 *     windows, and emit ranked pre-warm signals so the healer / context
 *     engine can pre-load the files most likely to be touched next.
 *   - PRE-WARM SINK (Phase 8): every emitted signal is routed directly into
 *     a speculative executor so candidate plans are pre-compiled before the
 *     edit lands (setPrewarmSink / routePrewarm in 2.body/execution).
 * =============================================================================
 */

export interface SamplePoint {
  t: number;
  value: number;
}

export interface ForecastPoint {
  t: number;
  value: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  series: ForecastPoint[];
  trend: 'up' | 'down' | 'flat';
  slope: number;
  intercept: number;
  confidence: number;
  model: 'linear' | 'exponential';
  r2: number;
  nextValue: number;
}

export interface SimulateOptions {
  /** Number of future steps to project. Default 10. */
  horizon?: number;
  /** Confidence level 0..1. Default 0.95 (z≈1.96). */
  confidence?: number;
  /** Smoothing factor 0..1 for exponential model. Default 0.3. */
  alpha?: number;
  /** Force the forecast model. Default: auto (linear vs exponential). */
  model?: 'linear' | 'exponential';
}

export interface ScenarioResult<T> {
  scenario: string;
  steps: T[];
  finalState: T;
}

// ---------------------------------------------------------------------------
// PHASE 7 — PREDICTIVE LOOP TYPES
// ---------------------------------------------------------------------------

export interface ChangeEvent {
  /** Repo-relative file path that changed. */
  path: string;
  timestamp: number;
  /** Optional importance weight (default 1). */
  weight?: number;
}

export interface PreWarmSignal {
  path: string;
  confidence: number;
  predictedAt: number;
  /** The path whose change triggered this prediction. */
  cause: string;
  windowMs: number;
}

const MAX_EVENTS = 4096;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_INTERVAL_MS = 5_000;

/** Fit helper — ordinary least squares on (t, value). */
function fitLinear(samples: SamplePoint[]): { slope: number; intercept: number; r2: number } {
  const n = samples.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
  if (n === 1) return { slope: 0, intercept: samples[0].value, r2: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (const s of samples) {
    sumX += s.t;
    sumY += s.value;
    sumXY += s.t * s.value;
    sumXX += s.t * s.t;
    sumYY += s.value * s.value;
  }

  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const s of samples) {
    const predicted = slope * s.t + intercept;
    ssTot += (s.value - meanY) * (s.value - meanY);
    ssRes += (s.value - predicted) * (s.value - predicted);
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  return { slope, intercept, r2 };
}

/** Exponential smoothing (single) — returns smoothed last value. */
function exponentialSmooth(samples: SamplePoint[], alpha: number): number {
  if (samples.length === 0) return 0;
  let smoothed = samples[0].value;
  for (let i = 1; i < samples.length; i++) {
    smoothed = alpha * samples[i].value + (1 - alpha) * smoothed;
  }
  return smoothed;
}

/** Residual standard error from the linear fit. */
function residualStd(samples: SamplePoint[], slope: number, intercept: number): number {
  if (samples.length < 3) return 0;
  let ss = 0;
  for (const s of samples) {
    const e = s.value - (slope * s.t + intercept);
    ss += e * e;
  }
  return Math.sqrt(ss / (samples.length - 2));
}

export class FutureSimulator {
  [key: string]: any;
  private samples: SamplePoint[] = [];

  // Phase 7 predictive-loop state.
  private events: ChangeEvent[] = [];
  private lastSeen = new Map<string, number>();
  private cooc = new Map<string, Map<string, number>>();
  private preWarmCbs = new Set<(signal: PreWarmSignal) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private emittedSignals = 0;
  // Phase 8: direct pre-warm routing into the speculative executor.
  private prewarmSink: ((signal: PreWarmSignal) => void) | null = null;

  constructor(history: SamplePoint[] | number[] = []) {
    for (const item of history) {
      if (typeof item === 'number') {
        this.samples.push({ t: this.samples.length, value: item });
      } else {
        this.samples.push({ t: item.t, value: item.value });
      }
    }
  }

  /** Append a historical sample point. */
  public addSample(t: number, value: number): void {
    this.samples.push({ t, value });
  }

  public get size(): number {
    return this.samples.length;
  }

  /**
   * Forecast `horizon` future steps from the observed series.
   */
  public forecast(options: SimulateOptions = {}): ForecastResult {
    const horizon = options.horizon ?? 10;
    const confidence = options.confidence ?? 0.95;
    const alpha = options.alpha ?? 0.3;
    const z =
      confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : confidence >= 0.9 ? 1.645 : 1.0;

    const useExponential = options.model === 'exponential' || (this.samples.length >= 5 && this.noiseRatio() > 0.35);

    const { slope, intercept, r2 } = fitLinear(this.samples);
    const sigma = residualStd(this.samples, slope, intercept);
    const lastT = this.samples.length > 0 ? this.samples[this.samples.length - 1].t : 0;
    const smoothBase = exponentialSmooth(this.samples, alpha);
    const base = useExponential ? smoothBase : intercept + slope * lastT;

    const series: ForecastPoint[] = [];
    let next = base;
    for (let i = 1; i <= horizon; i++) {
      const t = lastT + i;
      next = useExponential ? base + slope * i : intercept + slope * t;
      const band = useExponential ? sigma * z * (1 + i * 0.1) : sigma * z * Math.sqrt(1 + i / Math.max(1, this.samples.length));
      series.push({
        t,
        value: Number(next.toFixed(4)),
        lower: Number((next - band).toFixed(4)),
        upper: Number((next + band).toFixed(4)),
      });
    }

    const trend = Math.abs(slope) < 1e-9 ? 'flat' : slope > 0 ? 'up' : 'down';
    const model = (useExponential ? 'exponential' : 'linear') as ForecastResult['model'];

    return {
      series,
      trend,
      slope: Number(slope.toFixed(6)),
      intercept: Number(intercept.toFixed(6)),
      confidence,
      model,
      r2: Number(r2.toFixed(4)),
      nextValue: series.length > 0 ? series[series.length - 1].value : 0,
    };
  }

  /**
   * Run a deterministic scenario simulation.
   * `stepFn(prev, stepIndex) -> next` is applied `iterations` times.
   */
  public simulate<T>(
    scenario: string,
    initial: T,
    stepFn: (prev: T, stepIndex: number) => T,
    iterations: number
  ): ScenarioResult<T> {
    const steps: T[] = [initial];
    let current = initial;
    for (let i = 1; i <= iterations; i++) {
      current = stepFn(current, i);
      steps.push(current);
    }
    return { scenario, steps, finalState: current };
  }

  /**
   * Detect anomalous historical samples (> z*sigma from the trend).
   */
  public detectAnomalies(threshold = 2.0): SamplePoint[] {
    if (this.samples.length < 4) return [];
    const { slope, intercept } = fitLinear(this.samples);
    const sigma = residualStd(this.samples, slope, intercept) || 1;
    return this.samples.filter((s) => Math.abs(s.value - (slope * s.t + intercept)) > threshold * sigma);
  }

  public clear(): void {
    this.samples = [];
    this.resetPredictions();
  }

  // ---------------------------------------------------------------------------
  // PHASE 7 — PREDICTIVE LOOP
  // ---------------------------------------------------------------------------

  /**
   * Ingest change events (e.g. the IndexDelta added/modified/removed lists
   * from refreshIndex) and learn co-occurrence within `windowMs`.
   */
  public feed(changes: ChangeEvent | ChangeEvent[], windowMs: number = DEFAULT_WINDOW_MS): void {
    const list = Array.isArray(changes) ? changes : [changes];
    const now = Date.now();
    for (const change of list) {
      const path = change.path;
      const ts = change.timestamp || now;
      const weight = change.weight ?? 1;

      this.events.push({ path, timestamp: ts, weight });
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
      this.lastSeen.set(path, Math.max(this.lastSeen.get(path) ?? 0, ts));

      // Pairwise co-occurrence with every other change inside the window.
      const mine = this.cooc.get(path) ?? new Map<string, number>();
      for (const other of this.events) {
        if (other.path === path) continue;
        if (ts - other.timestamp > windowMs) continue;
        mine.set(other.path, (mine.get(other.path) ?? 0) + weight * (other.weight ?? 1));
        const theirs = this.cooc.get(other.path) ?? new Map<string, number>();
        theirs.set(path, (theirs.get(path) ?? 0) + weight * (other.weight ?? 1));
        this.cooc.set(other.path, theirs);
      }
      this.cooc.set(path, mine);
    }
  }

  /**
   * Predict the files most likely to be touched next, given the most recent
   * change as the trigger. Score = co-occurrence count × recency decay;
   * confidence is normalized to (0..1] against the best candidate.
   */
  public predictNext(windowMs: number = DEFAULT_WINDOW_MS, limit = 5): PreWarmSignal[] {
    if (this.events.length === 0) return [];
    const trigger = this.events[this.events.length - 1];
    const now = Date.now();
    const candidates = this.cooc.get(trigger.path);
    if (!candidates || candidates.size === 0) return [];

    const scored: Array<{ path: string; score: number }> = [];
    for (const [path, count] of candidates) {
      const lastTs = this.lastSeen.get(path) ?? trigger.timestamp;
      const age = Math.max(0, now - lastTs);
      const decay = Math.exp(-age / Math.max(1, windowMs));
      scored.push({ path, score: count * decay });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    const maxScore = top.length > 0 ? top[0].score : 0;

    return top.map((c) => ({
      path: c.path,
      confidence: maxScore > 0 ? Number((c.score / maxScore).toFixed(4)) : 0,
      predictedAt: now,
      cause: trigger.path,
      windowMs,
    }));
  }

  /** Subscribe to pre-warm signals (background loop emission). */
  public onPreWarm(cb: (signal: PreWarmSignal) => void): () => void {
    this.preWarmCbs.add(cb);
    return () => this.preWarmCbs.delete(cb);
  }

  /** Phase 8: route every emitted pre-warm signal directly to a consumer
   *  (e.g. a SpeculativeExecutor). Pass null to unroute. */
  public setPrewarmSink(sink: ((signal: PreWarmSignal) => void) | null): void {
    this.prewarmSink = sink
  }

  /** Start the background predictive loop: emit top signals every interval. */
  public start(intervalMs: number = DEFAULT_INTERVAL_MS, windowMs: number = DEFAULT_WINDOW_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const signal of this.predictNext(windowMs)) {
        this.emittedSignals++;
        for (const cb of Array.from(this.preWarmCbs)) {
          try {
            cb(signal);
          } catch {
            // subscriber errors must not kill the loop
          }
        }
        if (this.prewarmSink) {
          try {
            this.prewarmSink(signal)
          } catch {
            // sink errors must not kill the loop
          }
        }
      }
    }, intervalMs);
  }

  /** Stop the background predictive loop. */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Drop all predictive state (events, co-occurrence, subscriptions). */
  public resetPredictions(): void {
    this.stop();
    this.events = [];
    this.lastSeen.clear();
    this.cooc.clear();
    this.emittedSignals = 0;
  }

  public get eventCount(): number {
    return this.events.length;
  }

  public get signalCount(): number {
    return this.emittedSignals;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  private noiseRatio(): number {
    if (this.samples.length < 3) return 0;
    const { slope, intercept } = fitLinear(this.samples);
    const sigma = residualStd(this.samples, slope, intercept);
    const mean = this.samples.reduce((acc, s) => acc + s.value, 0) / this.samples.length;
    return mean === 0 ? 0 : sigma / Math.abs(mean);
  }
}

export default FutureSimulator;
