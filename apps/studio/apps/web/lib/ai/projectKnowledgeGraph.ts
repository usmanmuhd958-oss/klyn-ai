export type GraphNodeType =
  | "file"
  | "component"
  | "service"
  | "database"
  | "api";

export interface KnowledgeNode {
  id: string;
  projectId: string;
  type: GraphNodeType;
  name: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  relation: string;
}

interface GraphSummary {
  summary: string;
  components: string[];
}

class ProjectKnowledgeGraph {
  private nodes: KnowledgeNode[] = [];
  private edges: KnowledgeEdge[] = [];

  addNode(node: Omit<KnowledgeNode, "id">) {
    const created: KnowledgeNode = {
      id: crypto.randomUUID(),
      ...node,
    };

    this.nodes.push(created);
    return created;
  }

  connect(source: string, target: string, relation: string) {
    this.edges.push({
      source,
      target,
      relation,
    });
  }

  findProjectNodes(projectId: string) {
    return this.nodes.filter((node) => node.projectId === projectId);
  }

  async summary(projectId: string): Promise<GraphSummary> {
    const nodes = this.findProjectNodes(projectId);

    return {
      summary: `Project contains ${nodes.length} indexed architecture nodes.`,
      components: nodes
        .filter((node) => node.type === "component")
        .map((node) => node.name),
    };
  }

  clearProject(projectId: string) {
    this.nodes = this.nodes.filter((node) => node.projectId !== projectId);
  }
}

export const projectKnowledgeGraph = new ProjectKnowledgeGraph();
