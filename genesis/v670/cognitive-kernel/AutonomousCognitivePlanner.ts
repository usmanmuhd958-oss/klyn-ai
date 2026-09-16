export class AutonomousCognitivePlanner {
  plan(goal:string){
    return {
      status:"planned",
      goal
    };
  }
}
