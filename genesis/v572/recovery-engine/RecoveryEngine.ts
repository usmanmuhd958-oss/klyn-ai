export class RecoveryEngine {
  recover(fault:any){
    return {
      fault,
      recovery:"executed"
    };
  }
}
