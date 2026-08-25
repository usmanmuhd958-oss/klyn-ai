export type MemoryType =
  | "decision"
  | "pattern"
  | "error"
  | "preference"
  | "architecture";

export interface AgentMemory {
  id: string;
  workspaceId: string;
  agentId: string;
  type: MemoryType;
  content: string;
  tags: string[];
  createdAt: number;
  importance: number;
}

export interface MemoryQuery {
  workspaceId: string;
  agentId?: string;
  search: string;
  limit?: number;
}

class AgentMemoryStore {
  private memories: AgentMemory[] = [];

  async remember(memory: Omit<AgentMemory, "id" | "createdAt">) {
    const entry: AgentMemory = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...memory,
    };

    this.memories.push(entry);
    return entry;
  }

  async recall(query: MemoryQuery): Promise<AgentMemory[]> {
    try {
      return this.memories
        .filter((memory) => memory.workspaceId === query.workspaceId)
        .filter((memory) => !query.agentId || memory.agentId === query.agentId)
        .filter((memory) =>
          memory.content.toLowerCase().includes(query.search.toLowerCase())
        )
        .sort((a, b) => b.importance - a.importance)
        .slice(0, query.limit ?? 10);
    } catch (error) {
      console.error("Memory retrieval failed", error);
      return [];
    }
  }

  async remove(memoryId: string) {
    this.memories = this.memories.filter((memory) => memory.id !== memoryId);
  }

  clearWorkspace(workspaceId: string) {
    this.memories = this.memories.filter(
      (memory) => memory.workspaceId !== workspaceId
    );
  }
}

export const agentMemory = new AgentMemoryStore();
