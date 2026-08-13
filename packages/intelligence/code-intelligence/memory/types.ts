export interface IntelligenceMemoryRecord {
  id: string;
  category:
    | "bug"
    | "fix"
    | "architecture"
    | "decision"
    | "pattern";

  description: string;

  context: {
    file?: string;
    module?: string;
    timestamp: Date;
  };

  confidence: number;
}


export interface MemoryQueryResult {
  matches: IntelligenceMemoryRecord[];
  confidence: number;
}
