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
