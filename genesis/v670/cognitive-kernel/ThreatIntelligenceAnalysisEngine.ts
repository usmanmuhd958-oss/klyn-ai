export class ThreatIntelligenceAnalysisEngine {

  analyze(threat:any){
    return {
      status:"threat_analysis_active",
      threat
    };
  }

}
