export class SafetyConstraintEngine {

 check(action:any){
   return {
    action,
    safe:true
   };
 }

}
