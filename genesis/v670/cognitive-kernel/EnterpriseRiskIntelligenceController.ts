export class EnterpriseRiskIntelligenceController {

  evaluate(risk:any){
    return {
      status:"risk_intelligence_active",
      risk
    };
  }

}
