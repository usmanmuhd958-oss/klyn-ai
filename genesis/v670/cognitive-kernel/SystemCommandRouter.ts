export class SystemCommandRouter {

  route(command:string){
    return {
      command,
      target:"execution-fabric"
    };
  }

}
