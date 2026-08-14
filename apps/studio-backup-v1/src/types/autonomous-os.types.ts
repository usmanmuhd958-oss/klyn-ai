export type OSModule =
 | "editor"
 | "agents"
 | "planning"
 | "workflow"
 | "testing"
 | "learning"
 | "collaboration"
 | "deployment"
 | "governance";


export interface OSCapability {
 id:string;
 module:OSModule;
 status:"online"|"offline";
 description:string;
}


export interface EngineeringDecision {
 id:string;
 intent:string;
 agent:string;
 action:string;
 timestamp:number;
}
