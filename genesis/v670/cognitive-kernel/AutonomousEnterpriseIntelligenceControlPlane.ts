export class AutonomousEnterpriseIntelligenceControlPlane {

  control(state:any){
    return {
      state,
      intelligenceControlActive:true
    };
  }

}
