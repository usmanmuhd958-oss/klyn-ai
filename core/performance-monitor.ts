export interface MetricRecord {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
}

export class PerformanceMonitor {
  private metrics: MetricRecord[] = [];

  public recordMetric(name: string, value: number, unit: string = 'ms'): void {
    this.metrics.push({
      name,
      value,
      unit,
      timestamp: Date.now()
    });
  }

  public getSummary(name: string): { avg: number; p95: number; p99: number } {
    const filtered = this.metrics.filter(m => m.name === name).map(m => m.value).sort((a, b) => a - b);
    if (filtered.length === 0) return { avg: 0, p95: 0, p99: 0 };

    const sum = filtered.reduce((acc, val) => acc + val, 0);
    const avg = Number((sum / filtered.length).toFixed(4));
    const p95Idx = Math.floor(filtered.length * 0.95);
    const p99Idx = Math.floor(filtered.length * 0.99);

    return {
      avg,
      p95: Number(filtered[p95Idx].toFixed(4)),
      p99: Number(filtered[p99Idx].toFixed(4))
    };
  }
}
