export class DecisionHistoryStore {

 add(decision:any){

  return {
   decision,
   archived:true
  };

 }

}
