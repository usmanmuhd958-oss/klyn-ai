#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="packages/intelligence/code-intelligence/memory"

mkdir -p "$ROOT"

cat > "$ROOT/types.ts" <<'TS'
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
TS


cat > "$ROOT/CodeIntelligenceMemory.ts" <<'TS'
import {
  IntelligenceMemoryRecord,
  MemoryQueryResult
} from "./types.js";


export class CodeIntelligenceMemory {

  private records: Map<string, IntelligenceMemoryRecord>;


  constructor() {
    this.records = new Map();
  }


  store(
    record: IntelligenceMemoryRecord
  ): void {

    this.records.set(
      record.id,
      record
    );

  }


  search(
    keyword: string
  ): MemoryQueryResult {

    const matches =
      Array.from(this.records.values())
      .filter(record =>
        record.description
        .toLowerCase()
        .includes(
          keyword.toLowerCase()
        )
      );


    return {
      matches,
      confidence:
        matches.length > 0
          ? 0.8
          : 0
    };

  }


  snapshot(): IntelligenceMemoryRecord[] {

    return Array.from(
      this.records.values()
    );

  }

}
TS


cat > "$ROOT/index.ts" <<'TS'
export * from "./types.js";
export * from "./CodeIntelligenceMemory.js";
TS


echo "✅ Code Intelligence Memory Layer installed"

