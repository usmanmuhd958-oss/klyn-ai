import type { Node, Edge } from "@xyflow/react";

export interface MissionGraph {
  nodes: Node[];
  edges: Edge[];
  intent: {
    objective: string;
    confidence: number;
  };
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function parseIntent(input: string): MissionGraph {
  const normalized = input.toLowerCase();

  const intentNodeId = createId("intent");
  const architectureId = createId("architecture");
  const agentId = createId("agent");

  const nodes: Node[] = [
    {
      id: intentNodeId,
      type: "architecture",
      position: {
        x: 100,
        y: 150,
      },
      data: {
        title: "Intent Mission",
        objective: input,
      },
    },
    {
      id: architectureId,
      type: "architecture",
      position: {
        x: 500,
        y: 150,
      },
      data: {
        title: detectArchitecture(normalized),
      },
    },
    {
      id: agentId,
      type: "agent",
      position: {
        x: 850,
        y: 350,
      },
      data: {
        name: "Architect Agent",
        status: "thinking",
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: createId("edge"),
      source: intentNodeId,
      target: architectureId,
    },
    {
      id: createId("edge"),
      source: architectureId,
      target: agentId,
    },
  ];

  return {
    nodes,
    edges,
    intent: {
      objective: input,
      confidence: calculateConfidence(input),
    },
  };
}

function detectArchitecture(intent: string) {
  if (intent.includes("api")) {
    return "API Gateway Architecture";
  }

  if (intent.includes("database") || intent.includes("db")) {
    return "Database System";
  }

  if (intent.includes("ui") || intent.includes("frontend")) {
    return "Frontend Application";
  }

  return "Software Architecture Graph";
}

function calculateConfidence(input: string) {
  if (input.length > 50) {
    return 0.92;
  }

  if (input.length > 20) {
    return 0.85;
  }

  return 0.70;
}
