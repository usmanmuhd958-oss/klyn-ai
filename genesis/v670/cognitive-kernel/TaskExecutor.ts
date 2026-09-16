export class TaskExecutor {
  run(task: any) {
    return {
      status: "completed",
      task
    };
  }
}
