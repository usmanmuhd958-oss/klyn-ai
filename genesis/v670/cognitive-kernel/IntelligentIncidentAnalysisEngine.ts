export class IntelligentIncidentAnalysisEngine {
  investigate(event:any){
    return {
      event,
      analysis:"completed"
    };
  }
}
