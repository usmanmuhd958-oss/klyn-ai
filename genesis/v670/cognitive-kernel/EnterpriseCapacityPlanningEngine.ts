export class EnterpriseCapacityPlanningEngine {

  plan(capacity:any){
    return {
      status:"capacity_planning_active",
      capacity
    };
  }

}
