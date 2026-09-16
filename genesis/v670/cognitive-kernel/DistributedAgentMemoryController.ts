export class DistributedAgentMemoryController {

  distribute(memory:string){
    return {
      memory,
      distributed:true
    };
  }

}
