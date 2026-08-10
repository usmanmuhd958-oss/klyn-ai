import { PermissionEngine } from "./PermissionEngine";
import { PolicyEnforcer } from "./PolicyEnforcer";
import { AuditEngine } from "./AuditEngine";
import { ComplianceController } from "./ComplianceController";

export class RuntimeGovernance {

 authorize(action:string){

   const permission =
    new PermissionEngine().check(action);

   const policy =
    new PolicyEnforcer().enforce(permission);

   const audit =
    new AuditEngine().record(action);

   const compliance =
    new ComplianceController().validate();

   return {
     policy,
     audit,
     compliance
   };

 }

}
