
export type AgentRole =
 | "planner"
 | "architect"
 | "coder"
 | "tester"
 | "security"
 | "deployment";


export type AgentStatus =
 | "idle"
 | "thinking"
 | "executing"
 | "verifying"
 | "completed"
 | "failed";


export interface AgentIdentity {

 id:string;

 role:AgentRole;

 capability:string[];

}


export interface AgentState {

 agent:AgentIdentity;

 status:AgentStatus;

 currentTask?:string;

 progress:number;

 updatedAt:number;

}


export interface AgentTask {

 id:string;

 intent:string;

 assignedAgent:string;

 createdAt:number;

}


