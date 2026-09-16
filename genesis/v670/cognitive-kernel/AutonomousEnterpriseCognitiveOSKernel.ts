export class AutonomousEnterpriseCognitiveOSKernel {

  status:string = "initializing";

  boot(){
    this.status="online";
    return this.status;
  }

}
