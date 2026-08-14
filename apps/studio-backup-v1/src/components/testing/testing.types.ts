export type TestType =
  | "unit"
  | "integration"
  | "e2e"
  | "security";

export type TestStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed";

export interface GeneratedTest {
  id:string;
  file:string;
  type:TestType;
  description:string;
  status:TestStatus;
  confidence:number;
}

export interface QualityScore {
  coverage:number;
  reliability:number;
  security:number;
  maintainability:number;
  overall:number;
}

export interface ValidationResult {
  success:boolean;
  score:QualityScore;
  tests:GeneratedTest[];
}
