export type AgentState =
"IDLE" |
"RUNNING" |
"FAILED" |
"COMPLETED";


export interface AgentStateRecord {

 agentId:string;

 state:AgentState;

 updatedAt:number;

}
