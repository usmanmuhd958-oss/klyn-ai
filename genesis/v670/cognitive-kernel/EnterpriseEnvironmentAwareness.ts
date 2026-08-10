export class EnterpriseEnvironmentAwareness {

  observe(context:any){
    return {
      status:"environment_awareness_active",
      context
    };
  }

}
