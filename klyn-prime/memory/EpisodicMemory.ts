export interface MemoryRecord {
  id: string;
  timestamp: number;
  event: string;
  context: Record<string, unknown>;
  outcome?: string;
}

export class EpisodicMemory {
  private memories: MemoryRecord[] = [];

  store(record: MemoryRecord) {
    this.memories.push(record);
  }

  recall(query: string): MemoryRecord[] {
    return this.memories.filter(memory =>
      memory.event.toLowerCase().includes(query.toLowerCase())
    );
  }

  all() {
    return this.memories;
  }
}
