export class CognitiveTaskRoutingEngine {

  route(task:any){
    return {
      task,
      routeSelected:true
    };
  }

}
