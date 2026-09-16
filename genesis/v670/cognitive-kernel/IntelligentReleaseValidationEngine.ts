export class IntelligentReleaseValidationEngine {
  validate(release:any){
    return {
      release,
      validated:true
    };
  }
}
