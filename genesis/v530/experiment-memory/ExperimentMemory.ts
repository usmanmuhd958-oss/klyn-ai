export class ExperimentMemory {
  private history: unknown[] = [];

  record(event: unknown) {
    this.history.push(event);
  }

  getHistory() {
    return this.history;
  }
}
