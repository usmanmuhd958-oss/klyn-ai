export class UnifiedIntelligenceCoordinationController {
  coordinate(intelligence:any){
    return {
      intelligence,
      coordinated:true
    };
  }
}
