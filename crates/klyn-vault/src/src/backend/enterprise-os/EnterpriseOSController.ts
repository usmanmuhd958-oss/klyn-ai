import {GovernanceEngine} from "./GovernanceEngine.js";
import {SecurityIntelligence} from "./SecurityIntelligence.js";
import {ComplianceManager} from "./ComplianceManager.js";
import {CostIntelligenceEngine} from "./CostIntelligenceEngine.js";


export class EnterpriseOSController {

  governance=new GovernanceEngine();

  security=new SecurityIntelligence();

  compliance=new ComplianceManager();

  costs=new CostIntelligenceEngine();



  evaluate(input:any){

    return {

      governance:
        this.governance.evaluate(input.policy),

      security:
        this.security.analyze(input.system),

      compliance:
        this.compliance.check(input.system),

      cost:
        this.costs.analyze(input.resources)

    };

  }

}
