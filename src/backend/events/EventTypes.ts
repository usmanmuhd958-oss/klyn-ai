export type BackendEventType =
 | "RUNTIME_STARTED"
 | "RUNTIME_STOPPED"
 | "MEMORY_UPDATED"
 | "SERVICE_REGISTERED"
 | "TASK_EXECUTED"
 | "ERROR_OCCURRED";


export interface BackendEvent {

 id:string;

 type:BackendEventType;

 payload:unknown;

 timestamp:number;

}
