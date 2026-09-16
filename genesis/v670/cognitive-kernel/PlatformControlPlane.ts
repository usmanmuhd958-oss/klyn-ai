import {OrganizationManager} from "./OrganizationManager";
import {UsageMeter} from "./UsageMeter";

export class PlatformControlPlane {

 private organizations=new OrganizationManager();
 private usage=new UsageMeter();

 status(){

  return {
   plane:"Enterprise Control Plane",
   organizations:"online",
   usageMetering:"online"
  };

 }

}
