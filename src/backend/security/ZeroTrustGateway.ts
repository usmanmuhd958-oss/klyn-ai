import { AuthenticationEngine } from "./AuthenticationEngine.js";
import { AuthorizationEngine } from "./AuthorizationEngine.js";
import { ThreatDetector } from "./ThreatDetector.js";


export class ZeroTrustGateway {


 auth =
  new AuthenticationEngine();


 authorization =
  new AuthorizationEngine();


 threat =
  new ThreatDetector();



 verify(request:any){

  const identity =
   this.auth.authenticate(
    request.identity
   );


  const threat =
   this.threat.analyze(
    request
   );


  const access =
   this.authorization.authorize(
    identity,
    request.action
   );


  return {

   identity,

   threat,

   access

  };


 }


}
