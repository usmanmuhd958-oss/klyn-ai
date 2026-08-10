export class AutonomousCommandRouter {

  route(command:any){
    return {
      routed:true,
      command
    };
  }

}
