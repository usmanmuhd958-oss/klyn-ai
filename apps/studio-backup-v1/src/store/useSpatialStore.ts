"use client";

import { create } from "zustand";
import {
  addEdge, applyEdgeChanges, applyNodeChanges,
  type Connection, type Edge, type Node,
  type OnEdgesChange, type OnNodesChange,
} from "@xyflow/react";
import type { ReasoningStep, SwarmEvent } from "@klyn/agent-runtime";
import type { WorkflowRun } from "@klyn/workflow-engine";
import type { InlineDiff } from "@/components/editor/InlineDiffEngine";

/* ── Node data contracts ─────────────────────────────────────── */

export interface CodeNodeData {
  filePath: string;
  language: string;
  health: number;      // 0–100, from verifier agent
  drift: number;       // architectural drift score
  digest: string;      // live source digest
  [key: string]: unknown;
}

export interface AgentNodeData {
  role: string;
  model: string;
  status: string;
  tokensPerSec: number;
  trail: ReasoningStep[];
  [key: string]: unknown;
}

export interface RuntimeNodeData {
  service: string;
  cpu: number;
  memMb: number;
  rps: number;
  status: "healthy" | "degraded" | "down";
  [key: string]: unknown;
}

export type KlynNode =
  | Node<CodeNodeData, "codeNode">
  | Node<AgentNodeData, "agentNode">
  | Node<RuntimeNodeData, "runtimeNode">;

export interface KlynEdgeData {
  kind: "imports" | "edits" | "streams" | "impact";
  label?: string;
  live?: boolean;
  [key: string]: unknown;
}
export type KlynEdge = Edge<KlynEdgeData>;

export interface PendingDiff extends InlineDiff {
  nodeId: string;
}

export interface LogLine {
  id: string;
  t: number;
  level: "info" | "ok" | "warn";
  text: string;
}

/* ── Seed: a living system graph, not an empty void ───────────── */

const seedNodes: KlynNode[] = [
  {
    id: "agent-1", type: "agentNode", position: { x: 40, y: 40 },
    data: {
      role: "implementer", model: "klyn-core-1", status: "executing",
      tokensPerSec: 412,
      trail: [{ id: "r1", ts: Date.now(), kind: "thought", text: "Tracing session token expiry path…" }],
    },
  },
  {
    id: "code-1", type: "codeNode", position: { x: 380, y: 120 },
    data: {
      filePath: "src/core/auth/session.ts", language: "typescript",
      health: 92, drift: 0.03,
      digest: `export function createSession(userId: string) {\n  const token = sign({ sub: userId }, KEY);\n  return { token, ttl: 3600 };\n}`,
    },
  },
  {
    id: "code-2", type: "codeNode", position: { x: 760, y: 20 },
    data: {
      filePath: "src/core/auth/tokens.ts", language: "typescript",
      health: 88, drift: 0.07,
      digest: `export function sign(payload: unknown, key: CryptoKey) {\n  return jwt.encode(payload, key);\n}`,
    },
  },
  {
    id: "runtime-1", type: "runtimeNode", position: { x: 760, y: 260 },
    data: { service: "edge-runtime@us-east", cpu: 34, memMb: 412, rps: 1890, status: "healthy" },
  },
];

const seedEdges: KlynEdge[] = [
  { id: "e-agent-code", source: "agent-1", target: "code-1", type: "klynFlow", data: { kind: "edits", label: "editing", live: true } },
  { id: "e-c1-c2", source: "code-1", target: "code-2", type: "klynFlow", data: { kind: "imports", label: "imports" } },
  { id: "e-c1-rt", source: "code-1", target: "runtime-1", type: "klynFlow", data: { kind: "streams", label: "streams" } },
];

/* ── Store ────────────────────────────────────────────────────── */

interface SpatialState {
  nodes: KlynNode[];
  edges: KlynEdge[];
  workflow: WorkflowRun | null;
  logs: LogLine[];
  hudOpen: boolean;
  focusedNodeId: string | null;
  pendingDiff: PendingDiff | null;

  onNodesChange: OnNodesChange<KlynNode>;
  onEdgesChange: OnEdgesChange<KlynEdge>;
  onConnect: (conn: Connection) => void;

  ingestSwarmEvent: (e: SwarmEvent) => void;
  setWorkflow: (run: WorkflowRun | null) => void;
  queueDiff: (diff: PendingDiff) => void;
  resolveDiff: (nodeId: string, accepted: boolean, next?: string) => void;
  pushLog: (text: string, level?: LogLine["level"]) => void;
  setHud: (open: boolean) => void;
  focusNode: (id: string | null) => void;
}

export const useSpatialStore = create<SpatialState>((set, get) => ({
  nodes: seedNodes,
  edges: seedEdges,
  workflow: null,
  logs: [
    { id: "boot-1", t: Date.now(), level: "ok", text: "KLYN OS spatial kernel online" },
    { id: "boot-2", t: Date.now(), level: "info", text: "System graph hydrated — 4 nodes, 3 edges" },
  ],
  hudOpen: false,
  focusedNodeId: null,
  pendingDiff: null,

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges<KlynNode>(changes, s.nodes) })),
  onEdgesChange: (changes) =>
    set((s) => ({ edges: applyEdgeChanges<KlynEdge>(changes, s.edges) })),
  onConnect: (conn) =>
    set((s) => ({
      edges: addEdge(
        { ...conn, type: "klynFlow", data: { kind: "impact", label: "impact" } },
        s.edges,
      ) as KlynEdge[],
    })),

  /* Every swarm packet — Supabase broadcast or local simulation — lands here. */
  ingestSwarmEvent: (e) => {
    const { nodes } = get();
    switch (e.type) {
      case "agent:thought":
      case "agent:status": {
        set({
          nodes: nodes.map((n) => {
            if (n.id !== e.agentId || n.type !== "agentNode") return n;
            const data = { ...n.data };
            if (e.type === "agent:thought") {
              data.trail = [...data.trail.slice(-5), e.payload.step as ReasoningStep];
            } else {
              data.status = e.payload.status as string;
              if (typeof e.payload.tokensPerSec === "number")
                data.tokensPerSec = e.payload.tokensPerSec;
            }
            return { ...n, data };
          }),
        });
        break;
      }
      case "runtime:metrics": {
        set({
          nodes: nodes.map((n) =>
            n.type === "runtimeNode" && n.id === e.payload.nodeId
              ? { ...n, data: { ...n.data, ...e.payload } }
              : n,
          ),
        });
        break;
      }
      default:
        break;
    }
  },

  setWorkflow: (run) => set({ workflow: run }),

  queueDiff: (diff) =>
    set({ pendingDiff: diff, focusedNodeId: diff.nodeId }) &&
    get().pushLog(`Proposed edit → ${diff.nodeId} · Tab accept / Esc reject`, "warn"),

  resolveDiff: (nodeId, accepted, next) => {
    get().pushLog(
      accepted ? "Diff accepted — merged into system graph" : "Diff rejected — agent notified",
      accepted ? "ok" : "info",
    );
    set((s) => ({
      pendingDiff: null,
      nodes: accepted && next
        ? s.nodes.map((n) =>
            n.id === nodeId && n.type === "codeNode"
              ? { ...n, data: { ...n.data, digest: next } }
              : n,
          )
        : s.nodes,
    }));
  },

  pushLog: (text, level = "info") =>
    set((s) => ({
      logs: [...s.logs.slice(-199), { id: crypto.randomUUID(), t: Date.now(), level, text }],
    })),

  setHud: (open) => set({ hudOpen: open }),
  focusNode: (id) => set({ focusedNodeId: id }),
}));
