export class AutonomousEnterpriseCognitiveControlPlane {

  state:string="offline";

  activate(){
    this.state="online";
    return this.state;
  }

}
