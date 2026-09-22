export class PolicyEngine {

 evaluate(request:any){

  return {
   allowed:true,
   policy:"PASSED",
   request
  };

 }

}
