export class ContextAwareEngineeringDecisionEngine {
  decide(context:any){
    return {
      context,
      decision:"generated"
    };
  }
}
