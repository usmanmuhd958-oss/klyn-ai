import { supabaseAdmin } from "@/lib/db/client";

export interface VectorMemory {
  id: string;
  workspaceId: string;
  agentId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MemorySearchResult {
  memory: VectorMemory;
  similarity: number;
}

export interface StoreMemoryInput {
  workspaceId: string;
  agentId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export class VectorMemoryStore {
  async store(input: StoreMemoryInput): Promise<VectorMemory> {
    const { data, error } = await supabaseAdmin
      .from("agent_memories")
      .insert({
        workspace_id: input.workspaceId,
        agent_id: input.agentId,
        content: input.content,
        embedding: input.embedding,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed storing vector memory");
    }

    return this.mapRecord(data);
  }

  async search(params: {
    workspaceId: string;
    agentId?: string;
    embedding: number[];
    limit?: number;
  }): Promise<MemorySearchResult[]> {
    const { data, error } = await supabaseAdmin.rpc("match_agent_memories", {
      query_embedding: params.embedding,
      workspace_filter: params.workspaceId,
      agent_filter: params.agentId ?? null,
      match_count: params.limit ?? 5,
    });

    if (error) {
      throw new Error(`Vector search failed: ${error.message}`);
    }

    return (data ?? []).map((item: any) => ({
      memory: this.mapRecord(item),
      similarity: item.similarity,
    }));
  }

  async remove(memoryId: string) {
    const { error } = await supabaseAdmin
      .from("agent_memories")
      .delete()
      .eq("id", memoryId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async clearWorkspace(workspaceId: string) {
    const { error } = await supabaseAdmin
      .from("agent_memories")
      .delete()
      .eq("workspace_id", workspaceId);

    if (error) {
      throw new Error(error.message);
    }
  }

  private mapRecord(record: any): VectorMemory {
    return {
      id: record.id,
      workspaceId: record.workspace_id,
      agentId: record.agent_id,
      content: record.content,
      embedding: record.embedding,
      metadata: record.metadata ?? {},
      createdAt: record.created_at,
    };
  }
}

export const vectorMemoryStore = new VectorMemoryStore();
