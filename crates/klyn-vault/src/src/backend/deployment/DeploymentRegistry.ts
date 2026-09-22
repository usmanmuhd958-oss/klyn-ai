export class DeploymentRegistry {

 private deployments:any[] = [];


 register(deployment:any){

  this.deployments.push({
   ...deployment,
   timestamp:Date.now()
  });

 }


 list(){

  return this.deployments;

 }


}
