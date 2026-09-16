export class AutonomousScheduler {
  schedule(job:string){
    return {
      job,
      scheduled:true
    };
  }
}
