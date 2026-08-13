import { PolicyEngine } from "./PolicyEngine.js";
import { AuditTrail } from "./AuditTrail.js";
import { RiskAssessmentEngine } from "./RiskAssessmentEngine.js";


export class GovernanceController {


 policy =
  new PolicyEngine();


 audit =
  new AuditTrail();


 risk =
  new RiskAssessmentEngine();



 evaluate(request:any){

  const result =
   this.policy.evaluate(request);


  this.audit.record(result);


  return {

   governance:"ACTIVE",

   result

  };

 }


}
