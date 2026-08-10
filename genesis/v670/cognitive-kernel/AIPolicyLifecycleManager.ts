export class AIPolicyLifecycleManager {

  manage(policy:string){
    return {
      policy,
      lifecycle:"active"
    };
  }

}
