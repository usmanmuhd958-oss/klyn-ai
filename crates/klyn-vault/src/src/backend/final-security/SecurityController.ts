import {SecurityPolicyEngine} from "./SecurityPolicyEngine.js";
import {ThreatMonitor} from "./ThreatMonitor.js";
import {RuntimeGuard} from "./RuntimeGuard.js";
import {AccessValidator} from "./AccessValidator.js";
import {RecoveryManager} from "./RecoveryManager.js";


export class SecurityController {

  policy=new SecurityPolicyEngine();

  threats=new ThreatMonitor();

  guard=new RuntimeGuard();

  access=new AccessValidator();

  recovery=new RecoveryManager();


  secure(request:any){

    const access =
      this.access.validate(request);


    const policy =
      this.policy.evaluate(request);


    const threat =
      this.threats.detect(request);


    return {
      access,
      policy,
      threat
    };

  }

}
