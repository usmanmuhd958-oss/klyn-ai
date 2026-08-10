export class PlatformStateCoordinator {

  synchronize(state:any){
    return {
      status:"state_synchronized",
      state
    };
  }

}
