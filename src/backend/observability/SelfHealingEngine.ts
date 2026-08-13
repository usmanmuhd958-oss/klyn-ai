import { RecoveryStrategy } from "./RecoveryStrategy.js";


export class SelfHealingEngine {


 private recovery =
  new RecoveryStrategy();



 heal(issue:any){

  return this.recovery.execute(issue);

 }


}
