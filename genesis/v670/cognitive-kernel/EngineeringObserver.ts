import { EngineeringObservation } from "./EngineeringObservation";

export class EngineeringObserver {

 observe(target:string):EngineeringObservation {
   return {
     target,
     signals:[
       "runtime-state",
       "code-structure",
       "dependency-state"
     ]
   };
 }

}
