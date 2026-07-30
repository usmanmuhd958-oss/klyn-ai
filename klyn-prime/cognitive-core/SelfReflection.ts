export interface ReflectionReport {
  problem: string;
  observation: string;
  improvement: string;
}

export class SelfReflection {
  private history: ReflectionReport[] = [];

  analyze(
    problem: string,
    observation: string,
    improvement: string
  ) {
    const report: ReflectionReport = {
      problem,
      observation,
      improvement
    };

    this.history.push(report);

    return report;
  }

  getHistory() {
    return this.history;
  }

  latest() {
    return this.history[this.history.length - 1];
  }
}
