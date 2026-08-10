export class DeploymentController {

 deploy(target:string){

   return {
    target,
    status:"running"
   };

 }

}
