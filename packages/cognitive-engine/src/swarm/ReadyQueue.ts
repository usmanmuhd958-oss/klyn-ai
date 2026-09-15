export interface ReadyQueueTask { readonly id: string; readonly dependsOn: readonly string[]; }

/** Deterministic event-driven Kahn scheduler. Newly-ready nodes are dispatched immediately. */
export class ReadyQueue<T extends ReadyQueueTask = ReadyQueueTask> {
  private readonly tasks = new Map<string, T>();
  private readonly remaining = new Map<string, number>();
  private readonly dependents = new Map<string, string[]>();
  private readonly ready: string[] = [];
  private readonly queued = new Set<string>();
  private readonly completed = new Set<string>();

  constructor(tasks: readonly T[]) {
    for (const task of tasks) {
      if (this.tasks.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
      this.tasks.set(task.id, task);
      this.dependents.set(task.id, []);
    }
    for (const task of tasks) {
      for (const dependency of task.dependsOn) {
        if (!this.tasks.has(dependency)) throw new Error(`Unknown dependency ${dependency} for task ${task.id}`);
        this.remaining.set(task.id, (this.remaining.get(task.id) ?? 0) + 1);
        this.dependents.get(dependency)!.push(task.id);
      }
      this.remaining.set(task.id, this.remaining.get(task.id) ?? 0);
    }
    for (const children of this.dependents.values()) children.sort();
    for (const id of [...this.tasks.keys()].sort()) if (this.remaining.get(id) === 0) this.push(id);
  }

  get size(): number { return this.ready.length; }
  next(): T | undefined { const id = this.ready.shift(); if (id === undefined) return undefined; this.queued.delete(id); return this.tasks.get(id); }
  complete(id: string): readonly T[] {
    if (!this.tasks.has(id)) throw new Error(`Unknown task ${id}`);
    if (this.completed.has(id)) return [];
    this.completed.add(id);
    const newlyReady: string[] = [];
    for (const child of this.dependents.get(id)!) {
      const left = this.remaining.get(child)! - 1;
      this.remaining.set(child, left);
      if (left === 0) { this.push(child); newlyReady.push(child); }
    }
    newlyReady.sort();
    return newlyReady.map((taskId) => this.tasks.get(taskId)!);
  }

  drain(): readonly T[] { const result: T[] = []; let task; while ((task = this.next())) result.push(task); return result; }
  private push(id: string): void { if (this.queued.has(id) || this.completed.has(id)) return; this.queued.add(id); this.ready.push(id); this.ready.sort(); }
}
