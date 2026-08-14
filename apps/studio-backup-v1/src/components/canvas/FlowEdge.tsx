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
