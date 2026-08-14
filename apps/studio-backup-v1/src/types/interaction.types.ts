export interface UserIntent {
 id:string;
 command:string;
 context?:Record<string,unknown>;
 timestamp:number;
}

export interface AgentAction {
 id:string;
 action:string;
 confidence:number;
}
