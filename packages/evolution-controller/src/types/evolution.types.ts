export interface SystemObservation {
  timestamp: number;
  system: string;
  checks: Record<string,string>;
}


export interface EvolutionProposal {
  id: string;
  issue: string;
  action: string;
  risk: "low" | "medium" | "high";
}


