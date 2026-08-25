import { agentMemory } from "./agentMemory";
import { projectKnowledgeGraph } from "./projectKnowledgeGraph";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  projectId: string;
  intent: string;
  repositorySummary?: string;
  memories: string[];
  architecture: string[];
}

export class ContextManager {
  async build(params: {
    workspaceId: string;
    userId: string;
    projectId: string;
    intent: string;
  }): Promise<WorkspaceContext> {
    try {
      const memories = await agentMemory.recall({
        workspaceId: params.workspaceId,
        search: params.intent,
        limit: 5,
      });

      const graph = await projectKnowledgeGraph.summary(params.projectId);

      return {
        workspaceId: params.workspaceId,
        userId: params.userId,
        projectId: params.projectId,
        intent: params.intent,
        repositorySummary: graph.summary,
        memories: memories.map((memory) => memory.content),
        architecture: graph.components,
      };
    } catch (error) {
      console.error("Context building failed", error);
      throw new Error("Unable to build workspace context");
    }
  }

  formatForModel(context: WorkspaceContext) {
    return `
Workspace Intent:
${context.intent}

Repository:
${context.repositorySummary}

Architecture:
${context.architecture.join(", ")}

Relevant Memories:
${context.memories.join("\n")}
`;
  }
}

export const contextManager = new ContextManager();
