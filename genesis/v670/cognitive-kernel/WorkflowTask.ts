export interface WorkflowTask {

 id:string;

 goal:string;

 steps:string[];

 status:
 "created" |
 "running" |
 "completed" |
 "failed";

}
