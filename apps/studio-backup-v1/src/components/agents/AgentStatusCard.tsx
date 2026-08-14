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
