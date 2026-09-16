export interface RootCauseEvidence {
  source: string;
  description: string;
  confidence: number;
}

export interface RootCauseReport {
  incidentId: string;
  probableCause: string;
  confidence: number;
  evidence: RootCauseEvidence[];
  recommendations: string[];
}
