export class EnterpriseIntelligenceAccessControlController {
  authorize(identity:any){
    return {
      identity,
      authorized:true
    };
  }
}
