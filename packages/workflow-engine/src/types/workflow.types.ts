export interface WorkflowNode {
  id: string;
  type?: string;
  action?: string;
  agent?: string;
  dependsOn?: string[];
  data?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
}

export interface WorkflowStep {
  id: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowStep[];
}
