export class AutonomousActionExecutor {
  execute(action:string){
    return {
      status:"executed",
      action
    };
  }
}
