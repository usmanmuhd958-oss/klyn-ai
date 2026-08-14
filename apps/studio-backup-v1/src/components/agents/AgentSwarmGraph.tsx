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
