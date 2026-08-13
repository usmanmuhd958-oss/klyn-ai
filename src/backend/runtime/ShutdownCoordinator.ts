export class ShutdownCoordinator {

  shutdown(){

    return {
      shutdown:true,
      timestamp:Date.now()
    };

  }

}
