export class TaskDecomposer {
  decompose(task: string) {
    return [
      {
        id: crypto.randomUUID(),
        task,
        agent: "architect"
      }
    ];
  }
}
