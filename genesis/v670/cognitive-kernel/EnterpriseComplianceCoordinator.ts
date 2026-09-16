export class EnterpriseComplianceCoordinator {

  audit(requirement:any){
    return {
      status:"compliance_coordination_active",
      requirement
    };
  }

}
