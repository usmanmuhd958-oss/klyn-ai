export class FailureScenarioSimulator {

 testFailure(system:any){
   return {
    system,
    failures:[],
    recovery:"planned"
   };
 }

}
