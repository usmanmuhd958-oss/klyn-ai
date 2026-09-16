export class IntelligenceRouting {

 route(task:any){

   return {
     task,
     target:"optimal-intelligence-node",
     routing:"adaptive"
   };

 }

}
