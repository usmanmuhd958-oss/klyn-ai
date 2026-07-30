export type IntelligenceRequest = {
  id: string;
  objective: string;
  context: Record<string, unknown>;
};


export type IntelligenceResult = {
  success: boolean;
  actions: string[];
  reasoning: string[];
  confidence: number;
};


export interface IntelligenceModule {

  execute(
    request: IntelligenceRequest
  ): Promise<IntelligenceResult>;

}
