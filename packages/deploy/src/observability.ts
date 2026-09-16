// =============================================================================
// KLYN AI OS — deploy — Production Observability (Phase 14)
// File: packages/deploy/src/observability.ts
//
// Phase 14 capability #4 (observability half). Dependency-free production
// telemetry: a Prometheus-compatible metric registry (counters, gauges,
// histograms → text exposition format 0.0.4) and an OpenTelemetry-style
// span tracer (W3C trace/span ids, nano-second timestamps, parent links,
// status + attributes). Both are pure in-memory structs with zero I/O — the
// runtime_profiler and gateway_v2 hooks feed them, and /v1/metrics/prometheus
// + /v1/traces expose them:
//
//   const metrics = new PrometheusRegistry();
//   metrics.inc('klyn_repairs_total', 'Autonomous repairs dispatched', { route });
//   metrics.observe('klyn_route_latency_ms', 'Route latency', latencyMs, { route });
//   metrics.set('klyn_peers_online', 'Federated peers online', n);
//   const text = metrics.render();                 // Prometheus text format
//
//   const tracer = new OtelTracer('klyn-ai-os');
//   const span = tracer.startSpan('profiler.repair', { route });
//   ... work ...
//   span.end({ outcome: 'applied' });              // duration auto-recorded
//   const spans = tracer.export();                 // OTel-shaped JSON
//
// No external agent needed for the smoke suite; an OTLP exporter can stream
// `export()` payloads to any collector in production.
// =============================================================================
import crypto from 'node:crypto';

// -----------------------------------------------------------------------------
// PROMETHEUS-COMPATIBLE REGISTRY
// -----------------------------------------------------------------------------

export interface MetricLabel {
  name: string;
  value: string;
}

export interface CounterState {
  help: string;
  value: number;
}

export interface GaugeState {
  help: string;
  value: number;
}

export interface HistogramBucket {
  le: number;
  count: number;
}

export interface HistogramState {
  help: string;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

export interface PrometheusSnapshot {
  counters: Record<string, CounterState & { labels: MetricLabel[] }>;
  gauges: Record<string, GaugeState & { labels: MetricLabel[] }>;
  histograms: Record<string, HistogramState & { labels: MetricLabel[] }>;
}

const DEFAULT_HISTOGRAM_BUCKETS = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

export class PrometheusRegistry {
  private readonly counters = new Map<string, CounterState & { labels: MetricLabel[] }>();
  private readonly gauges = new Map<string, GaugeState & { labels: MetricLabel[] }>();
  private readonly histograms = new Map<string, HistogramState & { labels: MetricLabel[] }>();

  private key(name: string, labels: MetricLabel[] = []): string {
    const labelKey = labels.map((l) => `${l.name}=${l.value}`).join(',');
    return labelKey ? `${name}{${labelKey}}` : name;
  }

  /** Increment a counter (default +1). */
  inc(name: string, help: string, labels: Record<string, string> = {}, by = 1): void {
    const labelList = toLabels(labels);
    const key = this.key(name, labelList);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += by;
    } else {
      this.counters.set(key, { help, value: by, labels: labelList });
    }
  }

  /** Set an absolute gauge value. */
  set(name: string, help: string, value: number, labels: Record<string, string> = {}): void {
    const labelList = toLabels(labels);
    this.gauges.set(this.key(name, labelList), { help, value, labels: labelList });
  }

  /** Observe a value into a histogram (default buckets). */
  observe(name: string, help: string, value: number, labels: Record<string, string> = {}, buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS): void {
    const labelList = toLabels(labels);
    const key = this.key(name, labelList);
    const existing = this.histograms.get(key);
    if (existing) {
      existing.sum += value;
      existing.count += 1;
      for (let i = 0; i < existing.buckets.length; i++) {
        if (value <= existing.buckets[i]) existing.counts[i] += 1;
      }
    } else {
      const counts = buckets.map((b) => (value <= b ? 1 : 0));
      this.histograms.set(key, { help, buckets, counts, sum: value, count: 1, labels: labelList });
    }
  }

  /** Prometheus text exposition format (version 0.0.4). */
  render(): string {
    const lines: string[] = [];
    for (const [name, state] of this.counters) {
      const base = name.split('{')[0];
      lines.push(`# HELP ${base} ${state.help}`);
      lines.push(`# TYPE ${base} counter`);
      lines.push(`${name} ${state.value}`);
    }
    for (const [name, state] of this.gauges) {
      const base = name.split('{')[0];
      lines.push(`# HELP ${base} ${state.help}`);
      lines.push(`# TYPE ${base} gauge`);
      lines.push(`${name} ${state.value}`);
    }
    for (const [name, state] of this.histograms) {
      const base = name.split('{')[0];
      lines.push(`# HELP ${base} ${state.help}`);
      lines.push(`# TYPE ${base} histogram`);
      const labelSuffix = state.labels.length > 0 ? ',' : '';
      const labelStr = state.labels.map((l) => `${l.name}="${l.value}"`).join(',');
      for (let i = 0; i < state.buckets.length; i++) {
        const bucketName = `${base}_bucket{${labelStr}${labelSuffix}le="${state.buckets[i]}"}`;
        lines.push(`${bucketName} ${state.counts[i]}`);
      }
      lines.push(`${base}_bucket{${labelStr}${labelSuffix}le="+Inf"} ${state.count}`);
      lines.push(`${base}_sum{${labelStr}} ${state.sum}`);
      lines.push(`${base}_count{${labelStr}} ${state.count}`);
    }
    return lines.join('\n') + '\n';
  }

  /** Deterministic snapshot (tests + /v1/metrics/prometheus diagnostics). */
  snapshot(): PrometheusSnapshot {
    const sortedCounters: PrometheusSnapshot['counters'] = {};
    for (const [name, state] of Array.from(this.counters.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      sortedCounters[name] = { ...state, labels: state.labels.map((l) => ({ ...l })) };
    }
    const sortedGauges: PrometheusSnapshot['gauges'] = {};
    for (const [name, state] of Array.from(this.gauges.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      sortedGauges[name] = { ...state, labels: state.labels.map((l) => ({ ...l })) };
    }
    const sortedHistograms: PrometheusSnapshot['histograms'] = {};
    for (const [name, state] of Array.from(this.histograms.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      sortedHistograms[name] = { ...state, buckets: [...state.buckets], counts: [...state.counts], labels: state.labels.map((l) => ({ ...l })) };
    }
    return { counters: sortedCounters, gauges: sortedGauges, histograms: sortedHistograms };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

function toLabels(labels: Record<string, string>): MetricLabel[] {
  return Object.keys(labels)
    .sort()
    .map((name) => ({ name, value: String(labels[name]) }));
}

// -----------------------------------------------------------------------------
// OPENTELEMETRY-STYLE TRACER
// -----------------------------------------------------------------------------

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  durationMs: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  attributes: Record<string, string | number | boolean>;
  serviceName: string;
}

export interface SpanHandle {
  traceId: string;
  spanId: string;
  /** Complete the span; duration is computed from start to now. */
  end(attributes?: Record<string, string | number | boolean>, status?: 'OK' | 'ERROR' | 'UNSET'): void;
  /** Add attributes before completion. */
  setAttributes(attributes: Record<string, string | number | boolean>): void;
}

export interface OtelTracerOptions {
  /** Service name stamped on every span (default 'klyn-ai-os'). */
  serviceName?: string;
  /** Bounded span buffer (default 1024) — oldest spans evicted first. */
  maxSpans?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

export class OtelTracer {
  private readonly serviceName: string;
  private readonly maxSpans: number;
  private readonly nowFn: () => number;
  private readonly spans: OtelSpan[] = [];
  private spanCount = 0;

  constructor(options: OtelTracerOptions = {}) {
    this.serviceName = options.serviceName ?? 'klyn-ai-os';
    this.maxSpans = options.maxSpans ?? 1_024;
    this.nowFn = options.now ?? (() => Date.now());
  }

  /** Start a new span. Returns a handle whose end() records the duration. */
  startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    opts: { parentSpanId?: string | null; kind?: OtelSpan['kind'] } = {}
  ): SpanHandle {
    const traceId = crypto.randomBytes(16).toString('hex');
    const spanId = crypto.randomBytes(8).toString('hex');
    const startMs = this.nowFn();
    let endMs: number | null = null;
    let finalAttributes: Record<string, string | number | boolean> = { ...attributes };
    let status: OtelSpan['status'] = 'UNSET';

    const handle: SpanHandle = {
      traceId,
      spanId,
      setAttributes: (attrs) => {
        finalAttributes = { ...finalAttributes, ...attrs };
      },
      end: (attrs, finalStatus) => {
        if (endMs !== null) return; // idempotent
        if (attrs) finalAttributes = { ...finalAttributes, ...attrs };
        if (finalStatus) status = finalStatus;
        endMs = this.nowFn();
        const span: OtelSpan = {
          traceId,
          spanId,
          parentSpanId: opts.parentSpanId ?? null,
          name,
          kind: opts.kind ?? 'INTERNAL',
          startTimeUnixNano: String(startMs * 1_000_000),
          endTimeUnixNano: String(endMs * 1_000_000),
          durationMs: Math.max(0, endMs - startMs),
          status,
          attributes: finalAttributes,
          serviceName: this.serviceName,
        };
        this.spans.push(span);
        this.spanCount++;
        if (this.spans.length > this.maxSpans) this.spans.shift();
      },
    };
    return handle;
  }

  /** Run a synchronous function inside a span; the span ends with the
   *  function's success/failure and returns the function's result. */
  withSpan<T>(name: string, fn: () => T, attributes: Record<string, string | number | boolean> = {}): T {
    const span = this.startSpan(name, attributes);
    try {
      const result = fn();
      span.end({}, 'OK');
      return result;
    } catch (error) {
      span.end({ error: error instanceof Error ? error.message : String(error) }, 'ERROR');
      throw error;
    }
  }

  /** All completed spans, oldest first. */
  export(): OtelSpan[] {
    return this.spans.map((s) => ({ ...s, attributes: { ...s.attributes } }));
  }

  /** The service name stamped on every span. */
  getServiceName(): string {
    return this.serviceName;
  }

  /** Total spans ever created (including evicted). */
  get totalSpans(): number {
    return this.spanCount;
  }

  reset(): void {
    this.spans.length = 0;
    this.spanCount = 0;
  }
}

export default PrometheusRegistry;
