export interface AgentTask {
  id: string;
  description: string;
  priority: number;
}


export class TaskOrchestrator {

  private queue: AgentTask[] = [];


  add(task: AgentTask) {
    this.queue.push(task);
  }


  next() {

    return this.queue.sort(
      (a,b)=> b.priority - a.priority
    )[0];

  }


  list() {
    return this.queue;
  }
}
