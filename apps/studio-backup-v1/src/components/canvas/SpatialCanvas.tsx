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
