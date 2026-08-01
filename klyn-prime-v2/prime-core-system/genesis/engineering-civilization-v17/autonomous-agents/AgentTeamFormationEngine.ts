export class AgentTeamFormationEngine {

 createTeam(goal:string){
   return {
    goal,
    agents:[
      "architect",
      "security",
      "performance",
      "reliability"
    ]
   };
 }

}
