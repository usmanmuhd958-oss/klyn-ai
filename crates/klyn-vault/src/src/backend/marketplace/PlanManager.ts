export class PlanManager {

 private plans:any[] = [];


 create(plan:any){

  this.plans.push(plan);

  return {
   created:true,
   plan
  };

 }


 list(){

  return this.plans;

 }

}
