export class CognitivePlanningEngine {
  createPlan(input:string){
    return {
      status:"planning",
      input
    };
  }
}
