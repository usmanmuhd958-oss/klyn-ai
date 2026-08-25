export interface Metric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
}

class MetricsCollector {
  private metrics: Metric[] = [];

  record(name: string, value: number, tags?: Record<string, string>) {
    const metric: Metric = {
      name,
      value,
      tags,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);
    return metric;
  }

  increment(name: string, tags?: Record<string, string>) {
    return this.record(name, 1, tags);
  }

  gauge(name: string, value: number, tags?: Record<string, string>) {
    return this.record(name, value, tags);
  }

  query(name?: string) {
    if (!name) {
      return this.metrics;
    }

    return this.metrics.filter((metric) => metric.name === name);
  }

  clear() {
    this.metrics = [];
  }
}

export const metricsCollector = new MetricsCollector();
