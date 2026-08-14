
export interface AgentMutationMessage {

 id:string;

 agent:string;

 intent:string;

 targetFile:string;

 patch:string;

 verificationRequired:boolean;

}


export type AgentPermission =
 | "read"
 | "suggest"
 | "modify"
 | "deploy";


export interface AgentCapability {

 agentId:string;

 permissions:AgentPermission[];

}


export function canModify(
 capability:AgentCapability
){

 return capability.permissions.includes(
   "modify"
 );

}

