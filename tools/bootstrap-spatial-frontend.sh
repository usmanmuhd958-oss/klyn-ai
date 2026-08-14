#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  KLYN OS — SPATIAL STUDIO BOOTSTRAP (Phase 0)
#  Scaffolds the complete monorepo:
#    packages/agent-runtime   (swarm contract)
#    packages/workflow-engine (workflow contract)
#    apps/studio              (Next.js 15 spatial frontend)
#
#  Usage:
#    chmod +x tools/bootstrap-spatial-frontend.sh
#    ./tools/bootstrap-spatial-frontend.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "⚙  KLYN OS bootstrap → $ROOT"

# ── Directory skeleton ───────────────────────────────────────────────
mkdir -p \
  "$ROOT/packages/agent-runtime/src" \
  "$ROOT/packages/workflow-engine/src" \
  "$ROOT/apps/studio/src/app" \
  "$ROOT/apps/studio/src/store" \
  "$ROOT/apps/studio/src/lib" \
  "$ROOT/apps/studio/src/components/canvas" \
  "$ROOT/apps/studio/src/components/editor" \
  "$ROOT/apps/studio/src/components/hud" \
  "$ROOT/apps/studio/src/components/agents" \
  "$ROOT/apps/studio/src/components/runtime" \
  "$ROOT/apps/studio/src/components/providers"

# ════════════════════════════════════════════════════════════════════
echo "── [1/9] Workspace topology & package contracts ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/pnpm-workspace.yaml"
packages:
  - "apps/*"
  - "packages/*"
EOF

cat << 'EOF' > "$ROOT/packages/agent-runtime/package.json"
{
  "name": "@klyn/agent-runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
EOF

cat << 'EOF' > "$ROOT/packages/agent-runtime/src/index.ts"
export type AgentStatus =
  | "idle" | "planning" | "executing" | "verifying"
  | "blocked" | "done" | "failed";

export interface ReasoningStep {
  id: string;
  ts: number;
  kind: "thought" | "tool-call" | "observation" | "hypothesis";
  text: string;
  tool?: string;
}

export interface SwarmEvent {
  type:
    | "agent:spawn" | "agent:retire" | "agent:status" | "agent:thought"
    | "diff:proposed" | "runtime:metrics" | "workflow:step";
  agentId?: string;
  payload: Record<string, unknown>;
}

export interface AgentManifest {
  id: string;
  role: "planner" | "implementer" | "reviewer" | "healer";
  model: string;
  status: AgentStatus;
  tokensPerSec: number;
  currentTask?: string;
}
EOF

cat << 'EOF' > "$ROOT/packages/workflow-engine/package.json"
{
  "name": "@klyn/workflow-engine",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
EOF

cat << 'EOF' > "$ROOT/packages/workflow-engine/src/index.ts"
export type StepStatus =
  | "pending" | "running" | "passed" | "failed" | "skipped" | "healing";

export interface WorkflowStep {
  id: string;
  label: string;
  kind: "plan" | "edit" | "test" | "migrate" | "deploy" | "verify";
  status: StepStatus;
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkflowRun {
  id: string;
  intent: string;
  steps: WorkflowStep[];
  selfHealCount: number;
}
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [2/9] Studio configuration ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/package.json"
{
  "name": "@klyn/studio",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@klyn/agent-runtime": "workspace:*",
    "@klyn/workflow-engine": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-tooltip": "^1.1.6",
    "@supabase/supabase-js": "^2.47.0",
    "@xyflow/react": "^12.4.0",
    "@codemirror/state": "^6.5.0",
    "@codemirror/view": "^6.36.0",
    "@codemirror/commands": "^6.7.0",
    "@codemirror/language": "^6.10.0",
    "@codemirror/lang-typescript": "^6.0.0",
    "next": "^15.4.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "yjs": "^13.6.20",
    "y-websocket": "^2.1.0",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/next.config.ts"
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Canonical packages are transpiled, never path-imported.
  transpilePackages: ["@klyn/agent-runtime", "@klyn/workflow-engine"],
  experimental: { reactCompiler: true },
};

export default nextConfig;
EOF

cat << 'EOF' > "$ROOT/apps/studio/tailwind.config.js"
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
};
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [3/9] Design system — Cybernetic Minimalism ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/src/app/globals.css"
@import "tailwindcss";
@import "@xyflow/react/dist/style.css";

@theme {
  /* ── KLYN OS palette ─────────────────────────────── */
  --color-canvas: #0b0c10;
  --color-panel: #1f2833;
  --color-panel-deep: #141a22;
  --color-line: #2a3542;
  --color-ink: #c5c6c7;
  --color-ink-dim: #6f7f8f;
  --color-accent: #66fcf1;
  --color-accent-dim: #45a29e;
  --color-ok: #5cf1a6;
  --color-warn: #f1c866;
  --color-danger: #f1667c;

  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", monospace;

  /* ── Motion language ─────────────────────────────── */
  --animate-pulse-ring: klyn-pulse-ring 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  --animate-edge-dash: klyn-edge-dash 0.5s linear infinite;
  --animate-scan: klyn-scan 1.8s ease-in-out infinite;

  @keyframes klyn-pulse-ring {
    0%, 100% { box-shadow: 0 0 0 0 rgba(102, 252, 241, 0.35); }
    50%      { box-shadow: 0 0 0 8px rgba(102, 252, 241, 0); }
  }
  @keyframes klyn-edge-dash { to { stroke-dashoffset: -10; } }
  @keyframes klyn-scan {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(220%); }
  }
}

html, body { height: 100%; background: var(--color-canvas); }
* { scrollbar-width: thin; scrollbar-color: var(--color-line) transparent; }

/* Spatial canvas atmosphere */
.xyflow {
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(102, 252, 241, 0.05), transparent 60%),
    var(--color-canvas);
}
.react-flow__minimap {
  background: rgba(31, 40, 51, 0.85) !important;
  border: 1px solid var(--color-line);
  border-radius: 6px;
}
.react-flow__controls button {
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-line);
  color: var(--color-ink);
  fill: var(--color-ink);
}

/* Node I/O ports */
.klyn-handle {
  width: 7px; height: 7px; border-radius: 9999px;
  background: var(--color-accent-dim);
  border: 1.5px solid var(--color-canvas);
}

/* ── Inline diff decoration language (CodeMirror) ───── */
.klyn-diff-del {
  background: rgba(241, 102, 124, 0.10);
  text-decoration: line-through;
  text-decoration-color: rgba(241, 102, 124, 0.55);
}
.klyn-diff-ghost {
  margin: 1px 0;
  padding: 2px 0 2px 8px;
  border-left: 2px solid var(--color-accent);
  background: rgba(102, 252, 241, 0.06);
  color: var(--color-accent);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
}

@utility glass-panel {
  background: color-mix(in srgb, var(--color-panel) 82%, transparent);
  backdrop-filter: blur(14px);
  border: 1px solid var(--color-line);
}
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [4/9] App shell ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/src/app/layout.tsx"
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "KLYN OS · Spatial Engineering Studio",
  description: "Autonomous spatial AI engineering operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} bg-canvas font-sans text-ink antialiased`}>
        {children}
      </body>
    </html>
  );
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/app/page.tsx"
import SpatialCanvas from "@/components/canvas/SpatialCanvas";
import AgentSwarmGraph from "@/components/agents/AgentSwarmGraph";
import RuntimeMonitor from "@/components/runtime/RuntimeMonitor";
import AmbientCommandHUD from "@/components/hud/AmbientCommandHUD";
import TerminalHUD from "@/components/hud/TerminalHUD";
import RealtimeProvider from "@/components/providers/RealtimeProvider";

export default function StudioPage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-canvas">
      <RealtimeProvider>
        <SpatialCanvas />
        <AgentSwarmGraph />
        <RuntimeMonitor />
        <TerminalHUD />
        <AmbientCommandHUD />
      </RealtimeProvider>
    </main>
  );
}
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [5/9] Spatial state core ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/src/store/useSpatialStore.ts"
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
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [6/9] Lib layer — bus, stream, CRDT ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/src/lib/eventBus.ts"
import type { SwarmEvent } from "@klyn/agent-runtime";

export interface BusEvents {
  "swarm:event": SwarmEvent;
  "diff:accepted": { nodeId: string };
  "diff:rejected": { nodeId: string };
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private map = new Map<string, Set<Handler<never>>>();

  on<K extends keyof BusEvents>(event: K, fn: Handler<BusEvents[K]>): () => void {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn as Handler<never>);
    return () => this.map.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    this.map.get(event)?.forEach((fn) => (fn as Handler<BusEvents[K]>)(payload));
  }
}

export const bus = new EventBus();
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/lib/supabaseClient.ts"
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null; // offline-first posture
  client = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 30 } },
  });
  return client;
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/lib/yjsSync.ts"
import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";

export function attachSpaceDoc(room: string) {
  const doc = new Y.Doc();
  let provider: WebsocketProvider | null = null;
  const url = process.env.NEXT_PUBLIC_YJS_WS_URL;

  if (url && typeof window !== "undefined") {
    import("y-websocket")
      .then(({ WebsocketProvider: WS }) => {
        provider = new WS(url, room, doc, { connect: true });
      })
      .catch(() => {}); // silent degrade — local mode
  }

  return {
    doc,
    destroy: () => { provider?.destroy(); doc.destroy(); },
  };
}
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [7/9] Spatial canvas & living nodes ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/src/components/canvas/SpatialCanvas.tsx"
"use client";

import {
  Background, BackgroundVariant, Controls, MiniMap,
  ReactFlow, ReactFlowProvider,
} from "@xyflow/react";
import { useSpatialStore, type KlynNode } from "@/store/useSpatialStore";
import CodeNode from "./CodeNode";
import AgentNode from "./AgentNode";
import RuntimeNode from "./RuntimeNode";
import FlowEdge from "./FlowEdge";

const nodeTypes = { codeNode: CodeNode, agentNode: AgentNode, runtimeNode: RuntimeNode };
const edgeTypes = { klynFlow: FlowEdge };

function CanvasInner() {
  const nodes = useSpatialStore((s) => s.nodes);
  const edges = useSpatialStore((s) => s.edges);
  const onNodesChange = useSpatialStore((s) => s.onNodesChange);
  const onEdgesChange = useSpatialStore((s) => s.onEdgesChange);
  const onConnect = useSpatialStore((s) => s.onConnect);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
      minZoom={0.2}
      maxZoom={2.5}
      className="xyflow"
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color="#1b2431" />
      <MiniMap
        pannable zoomable
        nodeColor={(n: KlynNode) =>
          n.type === "agentNode" ? "#66fcf1" : n.type === "runtimeNode" ? "#f1c866" : "#45a29e"}
        maskColor="rgba(11, 12, 16, 0.72)"
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export default function SpatialCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/canvas/CodeNode.tsx"
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import CodeMirrorEngine from "@/components/editor/CodeMirrorEngine";
import { useSpatialStore, type CodeNodeData } from "@/store/useSpatialStore";

type Props = NodeProps<Node<CodeNodeData, "codeNode">>;

function CodeNodeImpl({ id, data, selected }: Props) {
  const focused = useSpatialStore((s) => s.focusedNodeId === id);
  const pendingDiff = useSpatialStore((s) =>
    s.pendingDiff?.nodeId === id ? s.pendingDiff : null);
  const focusNode = useSpatialStore((s) => s.focusNode);
  const resolveDiff = useSpatialStore((s) => s.resolveDiff);

  const healthTone =
    data.health > 85 ? "var(--color-ok)" : data.health > 60 ? "var(--color-warn)" : "var(--color-danger)";

  return (
    <div
      onDoubleClick={() => focusNode(focused ? null : id)}
      className={`glass-panel w-[340px] rounded-md font-mono transition-shadow ${
        selected || focused ? "ring-1 ring-accent shadow-[0_0_24px_rgba(102,252,241,0.15)]" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="klyn-handle" />

      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: healthTone }} />
        <span className="truncate text-[11px] text-ink">{data.filePath}</span>
        <span className="ml-auto rounded-sm border border-line px-1 py-0.5 text-[9px] uppercase tracking-widest text-ink-dim">
          drift {data.drift.toFixed(2)}
        </span>
      </header>

      {focused && pendingDiff ? (
        <div className="h-56 overflow-hidden">
          <CodeMirrorEngine
            code={pendingDiff.original}
            diff={pendingDiff}
            onAccept={(next) => resolveDiff(id, true, next)}
            onReject={() => resolveDiff(id, false)}
          />
        </div>
      ) : (
        <pre className="max-h-40 overflow-hidden px-3 py-2 text-[10.5px] leading-relaxed text-ink-dim">
          {data.digest}
        </pre>
      )}

      <footer className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[9px] uppercase tracking-widest text-ink-dim">
        <span>{data.language}</span>
        <div className="ml-auto h-1 w-16 overflow-hidden rounded bg-panel-deep">
          <div className="h-full" style={{ width: `${data.health}%`, background: healthTone }} />
        </div>
        <span>hp {data.health}</span>
      </footer>

      <Handle type="source" position={Position.Right} className="klyn-handle" />
    </div>
  );
}

export default memo(CodeNodeImpl);
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/canvas/AgentNode.tsx"
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useSpatialStore, type AgentNodeData } from "@/store/useSpatialStore";

type Props = NodeProps<Node<AgentNodeData, "agentNode">>;

const STATUS_TONE: Record<string, string> = {
  executing: "var(--color-accent)",
  planning: "var(--color-warn)",
  verifying: "var(--color-ok)",
  blocked: "var(--color-danger)",
  idle: "var(--color-ink-dim)",
  done: "var(--color-ok)",
  failed: "var(--color-danger)",
};

function AgentNodeImpl({ data, selected }: Props) {
  const lastThought = data.trail[data.trail.length - 1];
  const tone = STATUS_TONE[data.status] ?? "var(--color-ink-dim)";
  const active = data.status === "executing" || data.status === "planning";

  return (
    <div
      className={`glass-panel w-[260px] rounded-md font-mono ${active ? "animate-pulse-ring" : ""} ${
        selected ? "ring-1 ring-accent" : ""
      }`}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="relative flex h-2 w-2">
          {active && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style={{ background: tone }} />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: tone }} />
        </span>
        <span className="text-[11px] uppercase tracking-widest text-ink">{data.role}</span>
        <span className="ml-auto text-[9px] text-ink-dim">{data.tokensPerSec} t/s</span>
      </header>

      <div className="relative overflow-hidden px-3 py-2">
        {active && (
          <div className="absolute inset-y-0 w-1/3 animate-scan bg-gradient-to-r from-transparent via-accent/10 to-transparent" />
        )}
        <p className="truncate text-[10px] text-ink-dim">
          <span className="mr-1 text-accent">▸</span>
          {lastThought?.text ?? "awaiting directive"}
        </p>
      </div>

      <footer className="border-t border-line px-3 py-1.5 text-[9px] uppercase tracking-widest text-ink-dim">
        {data.model} · {data.status}
      </footer>

      <Handle type="source" position={Position.Right} className="klyn-handle" />
    </div>
  );
}

export default memo(AgentNodeImpl);
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/canvas/RuntimeNode.tsx"
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { RuntimeNodeData } from "@/store/useSpatialStore";

type Props = NodeProps<Node<RuntimeNodeData, "runtimeNode">>;

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-ink-dim">
      <span className="w-8">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded bg-panel-deep">
        <div className="h-full bg-accent-dim" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <span className="w-10 text-right font-mono">{value}</span>
    </div>
  );
}

function RuntimeNodeImpl({ data, selected }: Props) {
  const tone =
    data.status === "healthy" ? "var(--color-ok)"
    : data.status === "degraded" ? "var(--color-warn)" : "var(--color-danger)";

  return (
    <div className={`glass-panel w-[240px] rounded-md font-mono ${selected ? "ring-1 ring-accent" : ""}`}>
      <Handle type="target" position={Position.Left} className="klyn-handle" />
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
        <span className="truncate text-[11px] text-ink">{data.service}</span>
      </header>
      <div className="space-y-1.5 px-3 py-2">
        <Bar label="cpu" value={data.cpu} max={100} />
        <Bar label="mem" value={data.memMb} max={1024} />
        <Bar label="rps" value={data.rps} max={3000} />
      </div>
    </div>
  );
}

export default memo(RuntimeNodeImpl);
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/canvas/FlowEdge.tsx"
"use client";

import {
  BaseEdge, EdgeLabelRenderer, getBezierPath,
  type EdgeProps, type Edge,
} from "@xyflow/react";
import type { KlynEdgeData } from "@/store/useSpatialStore";

export default function FlowEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected,
}: EdgeProps<Edge<KlynEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  const live = data?.live === true;

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: live ? "var(--color-accent)" : "var(--color-accent-dim)",
          strokeWidth: selected ? 2 : 1.25,
          strokeDasharray: live ? "6 4" : undefined,
          animation: live ? "klyn-edge-dash 0.5s linear infinite" : undefined,
        }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
            className="nodrag nopoint absolute rounded-sm border border-line bg-panel/90 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-dim"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [8/9] Autonomy diff engine — Tab accept / Esc reject ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/src/components/editor/InlineDiffEngine.ts"
import { RangeSetBuilder, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";

export interface InlineDiff {
  original: string;
  proposed: string;
  source: string; // agent id that proposed the edit
  ts: number;
}

export type DiffOp =
  | { type: "equal"; text: string }
  | { type: "del"; text: string }
  | { type: "add"; text: string };

/* Line-level LCS diff — sufficient for card-sized edits;
   Phase 1 swaps in a Myers bit-parallel implementation. */
export function diffLines(a: string, b: string): DiffOp[] {
  const al = a.split("\n"), bl = b.split("\n");
  const m = al.length, n = bl.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (al[i] === bl[j]) { ops.push({ type: "equal", text: al[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", text: al[i] }); i++; }
    else { ops.push({ type: "add", text: bl[j] }); j++; }
  }
  while (i < m) { ops.push({ type: "del", text: al[i++] }); }
  while (j < n) { ops.push({ type: "add", text: bl[j++] }); }
  return ops;
}

export const setDiff = StateEffect.define<InlineDiff>();
export const clearDiff = StateEffect.define<null>();

/* Ghost blocks render proposed insertions without touching the doc. */
class GhostBlock extends WidgetType {
  constructor(readonly lines: string[]) { super(); }
  eq(other: GhostBlock) { return this.lines.join("\n") === other.lines.join("\n"); }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "klyn-diff-ghost";
    for (const line of this.lines) {
      const el = document.createElement("div");
      el.textContent = "+ " + line;
      wrap.appendChild(el);
    }
    return wrap;
  }
  ignoreEvent() { return false; }
}

interface DiffState { diff: InlineDiff | null; deco: DecorationSet; }

function buildDeco(state: EditorState, diff: InlineDiff): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ops = diffLines(diff.original, diff.proposed);
  let consumed = 0; // original lines consumed so far
  let pendingAdds: string[] = [];

  const flushAdds = () => {
    if (!pendingAdds.length) return;
    const pos = consumed === 0
      ? 0
      : state.doc.line(Math.min(consumed, state.doc.lines)).to;
    builder.add(pos, pos,
      Decoration.widget({ widget: new GhostBlock(pendingAdds), side: 1, block: true }));
    pendingAdds = [];
  };

  for (const op of ops) {
    if (op.type === "add") { pendingAdds.push(op.text); continue; }
    flushAdds();
    if (op.type === "del") {
      const n = consumed + 1;
      if (n <= state.doc.lines) {
        const { from, to } = state.doc.line(n);
        builder.add(from, to, Decoration.line({ class: "klyn-diff-del" }));
      }
    }
    consumed += 1;
  }
  flushAdds();
  return builder.finish();
}

export const diffField = StateField.define<DiffState>({
  create: () => ({ diff: null, deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiff)) return { diff: e.value, deco: buildDeco(tr.state, e.value) };
      if (e.is(clearDiff)) return { diff: null, deco: Decoration.none };
    }
    return { diff: value.diff, deco: value.deco.map(tr.changes) };
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.deco),
});

export function acceptDiff(view: EditorView): boolean {
  const { diff } = view.state.field(diffField);
  if (!diff) return false;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: diff.proposed },
    effects: clearDiff.of(null),
    userEvent: "input.complete",
  });
  return true;
}

export function rejectDiff(view: EditorView): boolean {
  if (!view.state.field(diffField).diff) return false;
  view.dispatch({ effects: clearDiff.of(null) });
  return true;
}

export const inlineDiffKeymap = keymap.of([
  { key: "Tab", run: acceptDiff },
  { key: "Escape", run: rejectDiff },
]);

export function inlineDiff() {
  return [diffField, inlineDiffKeymap];
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/editor/CodeMirrorEngine.tsx"
"use client";

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter,
  drawSelection, dropCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting,
} from "@codemirror/language";
import { typescript } from "@codemirror/lang-typescript";
import {
  acceptDiff, clearDiff, diffField, rejectDiff, setDiff, type InlineDiff,
} from "./InlineDiffEngine";

const klynTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent", color: "var(--color-ink)",
    fontSize: "11.5px", fontFamily: "var(--font-mono)", height: "100%",
  },
  ".cm-content": { caretColor: "var(--color-accent)", padding: "8px 0" },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--color-ink-dim)", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(102,252,241,0.04)" },
  "&.cm-focused": { outline: "none" },
}, { dark: true });

interface Props {
  code: string;
  diff?: InlineDiff | null;
  readOnly?: boolean;
  onAccept?: (next: string) => void;
  onReject?: () => void;
}

export default function CodeMirrorEngine({ code, diff = null, readOnly = false, onAccept, onReject }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onAccept, onReject });
  cbRef.current = { onAccept, onReject };

  useEffect(() => {
    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), history(),
        indentOnInput(), bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        typescript(), drawSelection(), dropCursor(), klynTheme,
        // Diff field + callback-aware keybindings (Tab/Esc)
        diffField,
        keymap.of([
          { key: "Tab", run: (v) => {
              const ok = acceptDiff(v);
              if (ok) cbRef.current.onAccept?.(v.state.doc.toString());
              return ok;
          } },
          { key: "Escape", run: (v) => {
              const ok = rejectDiff(v);
              if (ok) cbRef.current.onReject?.();
              return ok;
          } },
          ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.editable.of(!readOnly),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current! });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: diff ? setDiff.of(diff) : clearDiff.of(null) });
  }, [diff]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
}
EOF

# ════════════════════════════════════════════════════════════════════
echo "── [9/9] HUD layer, swarm panels & providers ──"
# ════════════════════════════════════════════════════════════════════

cat << 'EOF' > "$ROOT/apps/studio/src/components/hud/AmbientCommandHUD.tsx"
"use client";

import { useEffect, useState } from "react";
import { useSpatialStore } from "@/store/useSpatialStore";
import { bus } from "@/lib/eventBus";
import type { SwarmEvent } from "@klyn/agent-runtime";
import type { WorkflowRun } from "@klyn/workflow-engine";

const MODES = ["intent", "refactor", "heal"] as const;

export default function AmbientCommandHUD() {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("intent");
  const hudOpen = useSpatialStore((s) => s.hudOpen);
  const setHud = useSpatialStore((s) => s.setHud);
  const workflow = useSpatialStore((s) => s.workflow);
  const setWorkflow = useSpatialStore((s) => s.setWorkflow);
  const pushLog = useSpatialStore((s) => s.pushLog);
  const queueDiff = useSpatialStore((s) => s.queueDiff);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHud(!useSpatialStore.getState().hudOpen);
      }
      if (e.key === "Escape") setHud(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setHud]);

  /* Demonstrates the autonomy loop end-to-end without a backend. */
  const simulateAutonomy = (original: string) => {
    const thoughts = [
      "Parsing intent into execution graph…",
      "Impact analysis: 2 nodes within blast radius",
      "Drafting token rotation guard…",
    ];
    thoughts.forEach((text, i) =>
      setTimeout(() => bus.emit("swarm:event", {
        type: "agent:thought",
        agentId: "agent-1",
        payload: { step: { id: crypto.randomUUID(), ts: Date.now(), kind: "thought", text } },
      } satisfies SwarmEvent), 600 * (i + 1)));

    setTimeout(() => {
      queueDiff({
        nodeId: "code-1",
        original,
        proposed: original + `\n\nexport function rotateToken(token: string) {\n  return reissue(token, { ttl: 3600 });\n}`,
        source: "agent-1",
        ts: Date.now(),
      });
    }, 2600);
  };

  const submit = () => {
    const intent = value.trim();
    if (!intent) return;
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      intent,
      selfHealCount: 0,
      steps: [
        { id: "s1", label: "Parse intent", kind: "plan", status: "running" },
        { id: "s2", label: "Apply spatial edits", kind: "edit", status: "pending" },
        { id: "s3", label: "Verify graph integrity", kind: "verify", status: "pending" },
      ],
    };
    setWorkflow(run);
    pushLog(`Intent accepted: "${intent}" — workflow ${run.id.slice(0, 8)} dispatched`, "ok");
    setValue("");
    const code1 = useSpatialStore.getState().nodes.find((n) => n.id === "code-1");
    if (code1?.type === "codeNode") simulateAutonomy(code1.data.digest);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-2 font-mono">
      {workflow && (
        <div className="pointer-events-auto glass-panel flex items-center gap-3 rounded-md px-3 py-1.5 text-[9px] uppercase tracking-widest">
          {workflow.steps.map((s) => (
            <span key={s.id} className={
              s.status === "running" ? "text-accent"
              : s.status === "passed" ? "text-ok" : "text-ink-dim"
            }>
              {s.status === "running" ? "◐" : s.status === "passed" ? "✓" : "○"} {s.label}
            </span>
          ))}
        </div>
      )}

      {hudOpen && (
        <div className="pointer-events-auto glass-panel flex w-[640px] max-w-[92vw] items-center gap-2 rounded-lg px-3 py-2.5 shadow-[0_0_40px_rgba(102,252,241,0.08)]">
          <span className="text-accent">⟩</span>
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-widest transition-colors ${
                mode === m ? "border-accent text-accent" : "border-line text-ink-dim hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || (e.metaKey && e.key === "Enter")) submit();
            }}
            placeholder="State your intent. The swarm handles execution…"
            className="flex-1 bg-transparent text-[12px] text-ink placeholder:text-ink-dim focus:outline-none"
          />
          <kbd className="text-[9px] text-ink-dim">⌘↵</kbd>
        </div>
      )}
      {!hudOpen && (
        <button
          onClick={() => setHud(true)}
          className="pointer-events-auto glass-panel rounded-full px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-dim hover:text-accent"
        >
          ⌘K · summon command
        </button>
      )}
    </div>
  );
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/hud/TerminalHUD.tsx"
"use client";

import { useEffect, useRef, useState } from "react";
import { useSpatialStore } from "@/store/useSpatialStore";

export default function TerminalHUD() {
  const logs = useSpatialStore((s) => s.logs);
  const [open, setOpen] = useState(true);
  const tailRef = useRef<HTMLDivElement>(null);

  useEffect(() => { tailRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs.length]);

  return (
    <div className="absolute bottom-6 left-4 z-10 w-[320px] font-mono">
      <button
        onClick={() => setOpen(!open)}
        className="glass-panel w-full rounded-t-md px-3 py-1.5 text-left text-[9px] uppercase tracking-[0.2em] text-ink-dim hover:text-accent"
      >
        {open ? "▾" : "▸"} system telemetry · {logs.length}
      </button>
      {open && (
        <div className="glass-panel max-h-44 overflow-y-auto rounded-b-md border-t-0 px-3 py-2 text-[10px] leading-relaxed">
          {logs.map((l) => (
            <div key={l.id} className={
              l.level === "ok" ? "text-ok" : l.level === "warn" ? "text-warn" : "text-ink-dim"
            }>
              <span className="mr-1 text-accent/60">{new Date(l.t).toLocaleTimeString()}</span>
              {l.text}
            </div>
          ))}
          <div ref={tailRef} />
        </div>
      )}
    </div>
  );
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/agents/AgentSwarmGraph.tsx"
"use client";

import { useSpatialStore, type AgentNodeData } from "@/store/useSpatialStore";
import type { Node } from "@xyflow/react";
import AgentStatusCard from "./AgentStatusCard";

export default function AgentSwarmGraph() {
  const nodes = useSpatialStore((s) => s.nodes);
  const agents = nodes.filter((n): n is Node<AgentNodeData, "agentNode"> => n.type === "agentNode");

  return (
    <aside className="absolute left-4 top-4 z-10 w-[230px] space-y-2 font-mono">
      <div className="glass-panel rounded-md px-3 py-2 text-[9px] uppercase tracking-[0.25em] text-ink-dim">
        swarm · {agents.length} active
      </div>
      {agents.map((a) => <AgentStatusCard key={a.id} id={a.id} data={a.data} />)}
    </aside>
  );
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/agents/AgentStatusCard.tsx"
"use client";

import type { AgentNodeData } from "@/store/useSpatialStore";

export default function AgentStatusCard({ id, data }: { id: string; data: AgentNodeData }) {
  const last = data.trail[data.trail.length - 1];
  return (
    <div className="glass-panel rounded-md px-3 py-2 font-mono">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-accent">{data.role}</span>
        <span className="ml-auto text-[9px] text-ink-dim">{data.tokensPerSec} t/s</span>
      </div>
      <p className="mt-1 truncate text-[9.5px] text-ink-dim">{last?.text ?? "—"}</p>
      <div className="mt-1 text-[8.5px] uppercase tracking-widest text-ink-dim/70">{id} · {data.status}</div>
    </div>
  );
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/runtime/RuntimeMonitor.tsx"
"use client";

import { useSpatialStore } from "@/store/useSpatialStore";

const ICON: Record<string, string> = {
  running: "◐", passed: "✓", failed: "✕", pending: "○", healing: "↻", skipped: "–",
};

export default function RuntimeMonitor() {
  const workflow = useSpatialStore((s) => s.workflow);
  const nodes = useSpatialStore((s) => s.nodes);
  const runtimes = nodes.filter((n) => n.type === "runtimeNode");

  return (
    <aside className="absolute right-4 top-4 z-10 w-[250px] space-y-2 font-mono">
      <div className="glass-panel rounded-md px-3 py-2">
        <div className="text-[9px] uppercase tracking-[0.25em] text-ink-dim">workflow engine</div>
        {workflow ? (
          <ul className="mt-2 space-y-1 text-[10px]">
            {workflow.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className={s.status === "passed" ? "text-ok" : s.status === "running" ? "text-accent" : "text-ink-dim"}>
                  {ICON[s.status]}
                </span>
                <span className="text-ink">{s.label}</span>
                <span className="ml-auto uppercase text-ink-dim/70">{s.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[10px] text-ink-dim">No active run. Summon ⌘K.</p>
        )}
      </div>
      <div className="glass-panel rounded-md px-3 py-2 text-[9px] uppercase tracking-[0.25em] text-ink-dim">
        runtimes · {runtimes.length} healthy
      </div>
    </aside>
  );
}
EOF

cat << 'EOF' > "$ROOT/apps/studio/src/components/providers/RealtimeProvider.tsx"
"use client";

import { useEffect, type ReactNode } from "react";
import type { SwarmEvent } from "@klyn/agent-runtime";
import { bus } from "@/lib/eventBus";
import { getSupabase } from "@/lib/supabaseClient";
import { attachSpaceDoc } from "@/lib/yjsSync";
import { useSpatialStore } from "@/store/useSpatialStore";

export default function RealtimeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // 1. Local bus → spatial store (simulation + remote share one path)
    const offBus = bus.on("swarm:event", (e) => {
      useSpatialStore.getState().ingestSwarmEvent(e);
    });

    // 2. Supabase Realtime → local bus (degrades silently offline)
    const supabase = getSupabase();
    const channel = supabase
      ?.channel("klyn-swarm")
          .on("broadcast", { event: "swarm:event" }, ({ payload }) =>
            bus.emit("swarm:event", payload as SwarmEvent))
          .subscribe();

    // 3. CRDT space document (multiplayer merge backbone)
    const yjs = attachSpaceDoc("studio:main");

    return () => {
      offBus();
      channel?.unsubscribe();
      yjs.destroy();
    };
  }, []);

  return <>{children}</>;
}
EOF

# ── Finalize ─────────────────────────────────────────────────────────
chmod +x "$0"

echo ""
echo "✅ KLYN OS spatial frontend scaffolded: 29 files across 3 packages"
echo "   root: $ROOT"
echo ""
echo "Next steps:"
echo "  cd $ROOT"
echo "  pnpm install"
echo "  pnpm --filter @klyn/studio dev"
echo ""
echo "Then press ⌘K, type an intent, hit ⌘↵ — and Tab to accept the swarm's edit."
