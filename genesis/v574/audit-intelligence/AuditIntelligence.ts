export class AuditIntelligence {
  record(action:any){
    return {
      action,
      audited:true
    };
  }
}
