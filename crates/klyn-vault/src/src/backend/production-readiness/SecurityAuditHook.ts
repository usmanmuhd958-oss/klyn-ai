export class SecurityAuditHook {

  audit(target:any){

    return {

      target,

      security:"checked",

      issues:[]

    };

  }

}
