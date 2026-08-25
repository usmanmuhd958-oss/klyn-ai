"use client";

import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "executing"
  | "done"
  | "error";

export interface KlynAgent {
  id: string;
  name: string;
  role: "coder" | "architect" | "reviewer" | "guard";
  status: AgentStatus;
  currentTask: string;
  logs: string[];
}

export interface IntentState {
  objective: string;
  confidence: number;
  status: "empty" | "analyzing" | "planning" | "building" | "verified";
}

interface KlynStore {
  nodes: Node[];
  edges: Edge[];
  agents: KlynAgent[];
  intent: IntentState;
  setIntent: (intent: IntentState) => void;
  addNode: (node: Node) => void;
  updateNode: (id: string, data: Partial<Node["data"]>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: Edge) => void;
  updateAgent: (id: string, update: Partial<KlynAgent>) => void;
  addAgentLog: (id: string, log: string) => void;
  resetRuntime: () => void;
}

export const useKlynStore = create<KlynStore>((set) => ({
  nodes: [],
  edges: [],
  agents: [
    {
      id: "architect",
      name: "Architect",
      role: "architect",
      status: "idle",
      currentTask: "Waiting",
      logs: [],
    },
    {
      id: "coder",
      name: "Coder",
      role: "coder",
      status: "idle",
      currentTask: "Waiting",
      logs: [],
    },
    {
      id: "reviewer",
      name: "Reviewer",
      role: "reviewer",
      status: "idle",
      currentTask: "Waiting",
      logs: [],
    },
  ],
  intent: {
    objective: "",
    confidence: 0,
    status: "empty",
  },
  setIntent: (intent) => set({ intent }),
  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),
  updateNode: (id, data) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...data,
              },
            }
          : node
      ),
    })),
  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
    })),
  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges, edge],
    })),
  updateAgent: (id, update) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === id
          ? {
              ...agent,
              ...update,
            }
          : agent
      ),
    })),
  addAgentLog: (id, log) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === id
          ? {
              ...agent,
              logs: [...agent.logs, log],
            }
          : agent
      ),
    })),
  resetRuntime: () =>
    set({
      nodes: [],
      edges: [],
      intent: {
        objective: "",
        confidence: 0,
        status: "empty",
      },
    }),
}));
