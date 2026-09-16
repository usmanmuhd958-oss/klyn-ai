export class DeploymentPlanner {

  plan(target:any){

    return {
      target,
      strategy:"intelligent-deployment",
      status:"planned"
    };

  }

}
