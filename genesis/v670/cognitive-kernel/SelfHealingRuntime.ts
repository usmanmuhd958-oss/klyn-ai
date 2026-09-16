import { HealthMonitor } from "./HealthMonitor";
import { FailureDetector } from "./FailureDetector";
import { DiagnosisEngine } from "./DiagnosisEngine";
import { RecoveryController } from "./RecoveryController";

export class SelfHealingRuntime {

 run(){

   const health =
    new HealthMonitor().check();

   const failure =
    new FailureDetector().detect(health);

   const diagnosis =
    new DiagnosisEngine().analyze(failure);

   return new RecoveryController()
    .recover(diagnosis);

 }

}
