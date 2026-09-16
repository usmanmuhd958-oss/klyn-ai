export interface WorkflowState {

 workflowId:string;

 status:
 "CREATED" |
 "RUNNING" |
 "COMPLETED" |
 "FAILED";

}
