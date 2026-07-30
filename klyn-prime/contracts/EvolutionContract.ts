export interface EvolutionContract {

  analyze(): Promise<EvolutionReport>;

  improve(target: string): Promise<void>;

  rollback(version: string): Promise<void>;

}


export interface EvolutionReport {
  weaknesses: string[];
  improvements: string[];
  riskLevel: number;
}
