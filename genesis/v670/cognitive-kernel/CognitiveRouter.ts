export class CognitiveRouter {

 route(intent:string){

   if(intent.includes("code"))
     return "engineering-agent";

   if(intent.includes("research"))
     return "research-agent";

   return "general-agent";
 }

}
