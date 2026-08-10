export class EnterpriseCommandRoutingEngine {

  route(command:any){
    return {
      command,
      routingCompleted:true
    };
  }

}
