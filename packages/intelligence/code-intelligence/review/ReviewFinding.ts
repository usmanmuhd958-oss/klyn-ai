export type ReviewSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low";

export interface ReviewFinding {
  id: string;
  title: string;
  description: string;
  severity: ReviewSeverity;
  file: string;
  suggestion?: string;
}
