export class ComplianceEngine {
  evaluate(rule:any){
    return {
      rule,
      compliant:true
    };
  }
}
