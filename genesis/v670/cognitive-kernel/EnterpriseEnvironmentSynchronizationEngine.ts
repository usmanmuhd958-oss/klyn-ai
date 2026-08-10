export class EnterpriseEnvironmentSynchronizationEngine {

  synchronize(environment:string){
    return {
      environment,
      synchronized:true
    };
  }

}
