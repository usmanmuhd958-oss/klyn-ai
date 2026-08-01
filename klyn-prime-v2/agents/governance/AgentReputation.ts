export interface ReputationRecord {

 agentId:string;

 score:number;

 tasksCompleted:number;

 successRate:number;

}


export class AgentReputation {


 private records:ReputationRecord[]=[];


 update(record:ReputationRecord){

   this.records.push(record);

 }


 get(agentId:string){

   return this.records.find(
     r=>r.agentId===agentId
   );

 }


}
