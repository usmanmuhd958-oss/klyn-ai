import {SLOManager} from "./SLOManager";
import {IncidentManager} from "./IncidentManager";

export class SREController {

 private slo=new SLOManager();
 private incidents=new IncidentManager();

 status(){
   return {
    plane:"SRE",
    slo:"active",
    incidentManagement:"active"
   };
 }

}
