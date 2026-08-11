export class AutonomousAgentPlanningIntelligenceLayer {
  plan(goal:string){
    return {
      goal,
      plan:"generated"
    };
  }
}
