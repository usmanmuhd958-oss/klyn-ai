import { Agent } from "../core/Agent";


export class SwarmEngine {


  private agents:Agent[] = [];


  private readonly maxConcurrency: number;


  constructor(maxConcurrency: number = 8) {
    this.maxConcurrency = maxConcurrency;
  }


  addAgent(agent:Agent){
    this.agents.push(agent);
  }


  listAgents(){
    return this.agents;
  }


  async coordinate(task:string){
    const results = [];

    for(const agent of this.agents){
      results.push(
        await agent.execute(task)
      );
    }

    return results;
  }


  async coordinateParallel(task:string, concurrency: number = this.maxConcurrency){
    const results: any[] = new Array(this.agents.length);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];
      const promise = agent.execute(task).then(result => {
        results[i] = result;
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(p => p === promise),
          1
        );
      }
    }

    await Promise.all(executing);

    return results;
  }


}
