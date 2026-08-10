import { RuntimeHealth } from "./RuntimeHealth";

export class HealthMonitor {

 check():RuntimeHealth {

   return {
     status:"healthy",
     metrics:{
       memory:"ok",
       cpu:"ok",
       agents:"online"
     }
   };

 }

}
