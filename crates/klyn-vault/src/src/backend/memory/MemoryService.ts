export interface MemoryRecord {
  id: string;
  type: "episodic" | "semantic" | "procedural";
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export class MemoryService {

  private memories: MemoryRecord[] = [];

  store(record: MemoryRecord) {
    this.memories.push(record);

    return {
      success: true,
      id: record.id
    };
  }


  recall(query: string) {
    return this.memories.filter(memory =>
      memory.content
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  }


  stats() {
    return {
      total: this.memories.length
    };
  }

}
