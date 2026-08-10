export class DeploymentAgent {

 deploy(service:string){

  return {
   service,
   deployment:"executed"
  };

 }

}
