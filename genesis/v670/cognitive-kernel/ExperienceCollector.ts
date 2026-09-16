export class ExperienceCollector {

 collect(agent:string, action:string, result:any){

   return {
    agent,
    action,
    result,
    timestamp:Date.now()
   };

 }

}
