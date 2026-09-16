export class StrategicDecisionExecutionEngine {
  execute(decision:any){
    return {
      decision,
      execution:"completed"
    };
  }
}
