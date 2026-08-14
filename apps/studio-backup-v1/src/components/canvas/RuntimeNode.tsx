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
