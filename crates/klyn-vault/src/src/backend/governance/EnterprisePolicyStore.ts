export class EnterprisePolicyStore {


 private policies:any[]=[];


 add(policy:any){

  this.policies.push(policy);

 }


 list(){

  return this.policies;

 }


}
