export class SingularitySynchronizationEngine {

  synchronize(nodes:any[]){
    return {
      status:"singularity_sync_complete",
      nodes
    };
  }

}
