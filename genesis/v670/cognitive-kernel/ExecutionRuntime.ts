export class ExecutionRuntime {
  async execute(task: any) {
    return {
      executed: true,
      task
    };
  }
}
