/**
 * =============================================================================
 * KLYN AI OS — World Model / Prediction — FutureSimulator
 * File: world-model/prediction/FutureSimulator.ts
 * Version: 1.0.0
 *
 * A deterministic, dependency-free forecasting engine used by the Genesis V670
 * FutureRuntimeSimulator. Provides:
 *   - Time-series forecast via ordinary least squares regression.
 *   - Exponential smoothing for noisy series.
 *   - Confidence bands (normal approximation) for uncertainty.
 *   - Monte-Carlo-free scenario simulation with explicit iteration functions.
 *   - Trend classification and anomaly detection.
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

/**
 * Fit helper — ordinary least squares on (t, value).
 * Returns { slope, intercept, r2 }.
 */
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
