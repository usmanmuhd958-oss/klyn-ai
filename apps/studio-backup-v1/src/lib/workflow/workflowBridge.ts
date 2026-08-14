export interface WorkflowSignal {
 type:
 "PLAN"
 | "EXECUTE"
 | "VERIFY"
 | "RECOVER";
 payload: unknown;
 timestamp:number;
}

export function emitWorkflowSignal(
signal:WorkflowSignal
){
console.log(
"[KLYN WORKFLOW]",
signal
);
}
