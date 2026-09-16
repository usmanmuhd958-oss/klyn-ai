export class MultiAgentTaskAllocationController {
  allocate(task:string,agents:any[]){
    return {
      task,
      agents
    };
  }
}
