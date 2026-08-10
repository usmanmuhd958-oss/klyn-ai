export class RuntimeGovernor {

  regulate(state:any){
    return {
      runtime:"stable",
      state
    };
  }

}
