export type StepStatus =
  | "pending" | "running" | "passed" | "failed" | "skipped" | "healing";

export interface WorkflowStep {
  id: string;
  label: string;
  kind: "plan" | "edit" | "test" | "migrate" | "deploy" | "verify";
  status: StepStatus;
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkflowRun {
  id: string;
  intent: string;
  steps: WorkflowStep[];
  selfHealCount: number;
}
