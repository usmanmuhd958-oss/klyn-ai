import { TaskScheduler } from "../scheduler/TaskScheduler.js";
import { AgentQueue } from "../queue/AgentQueue.js";
import { RetryManager } from "../retry/RetryManager.js";
import { AgentValidator } from "../validation/AgentValidator.js";
import { AgentExecutor } from "../executor/AgentExecutor.js";

export class OrchestrationRuntime {

  private scheduler = new TaskScheduler();
  private queue = new AgentQueue();
  private retry = new RetryManager();
  private validator = new AgentValidator();
  private executor = new AgentExecutor();


  async execute(agent:any, task:any){

    this.scheduler.add(task);

    const queued = this.scheduler.next();

    this.queue.push(queued);

    const job = this.queue.pop();


    const result = await this.retry.execute(
      async()=> {
        return await this.executor.execute(agent, job);
      }
    );


    const validation =
      this.validator.validate(result);


    return {
      result,
      validation,
      timestamp: Date.now()
    };

  }

}
