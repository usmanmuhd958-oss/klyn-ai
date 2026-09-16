export type ImpactType =
  | "file-change"
  | "function-change"
  | "api-change"
  | "database-change";

export interface ImpactNode {
  id: string;
  type: ImpactType;
  name: string;
  affectedNodes: string[];
  riskScore: number;
}
