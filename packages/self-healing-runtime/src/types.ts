export type FailureType =
  | "runtime-error"
  | "type-error"
  | "dependency-error"
  | "performance";

export type HealingStatus =
  | "detected"
  | "analyzing"
  | "repairing"
  | "validated"
  | "failed";

export interface RuntimeFailure {
  id: string;
  type: FailureType;
  message: string;
  file?: string;
  timestamp: number;
}

export interface RepairAction {
  id: string;
  failureId: string;
  description: string;
  confidence: number;
  status: HealingStatus;
}

export interface HealingReport {
  failure: RuntimeFailure;
  repair: RepairAction;
}
