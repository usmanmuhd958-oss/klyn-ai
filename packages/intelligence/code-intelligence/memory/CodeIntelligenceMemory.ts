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
