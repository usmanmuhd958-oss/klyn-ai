export class ResourceIntelligence {

 analyze(){

   return {
     memory:process.memoryUsage(),
     uptime:process.uptime()
   };

 }

}
