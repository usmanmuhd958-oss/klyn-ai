
export type LearningEventType =
 | "execution"
 | "failure"
 | "success"
 | "optimization";

export interface LearningEvent {
 id:string;
 agentId:string;
 type:LearningEventType;
 action:string;
 result:string;
 score:number;
 timestamp:number;
}

export interface AgentMemory {
 agentId:string;
 executions:number;
 successes:number;
 failures:number;
 intelligenceScore:number;
 lastImprovement:number;
}

