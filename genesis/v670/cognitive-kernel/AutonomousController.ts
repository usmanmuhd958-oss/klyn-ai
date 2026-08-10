import {DecisionEngine} from "./DecisionEngine";
import {RuntimeGovernor} from "./RuntimeGovernor";
import {PolicyEngine} from "./PolicyEngine";
import {HealthMonitor} from "./HealthMonitor";

export class AutonomousController {

 decision = new DecisionEngine();
 governor = new RuntimeGovernor();
 policy = new PolicyEngine();
 health = new HealthMonitor();

 execute(task:any){

   const decision=this.decision.decide(task);
   const policy=this.policy.validate(decision);

   return {
    health:this.health.check(),
    runtime:this.governor.regulate(task),
    policy,
    decision
   };

 }

}
