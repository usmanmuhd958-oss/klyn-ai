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
