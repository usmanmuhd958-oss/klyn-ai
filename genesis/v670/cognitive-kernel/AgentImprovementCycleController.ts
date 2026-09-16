export class AgentImprovementCycleController {

  improve(metrics:any){
    return {
      metrics,
      improved:true
    };
  }

}
