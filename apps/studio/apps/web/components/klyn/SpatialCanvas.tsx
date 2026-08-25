"use client";

import { useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { useKlynStore } from "@/lib/store/useKlynStore";
import { useKlynRuntime } from "@/lib/hooks/useKlynRuntime";

import CodeNode from "./canvas/CodeNode";
import AgentNode from "./canvas/AgentNode";
import ArchitectureNode from "./canvas/ArchitectureNode";

const nodeTypes: NodeTypes = {
  code: CodeNode,
  agent: AgentNode,
  architecture: ArchitectureNode,
};

export default function SpatialCanvas() {
  useKlynRuntime();

  const runtimeNodes = useKlynStore((state) => state.nodes);
  const runtimeEdges = useKlynStore((state) => state.edges);

  const [nodes, setNodes, onNodesChange] = useNodesState(runtimeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(runtimeEdges);

  // Live sync Zustand runtime state with XYFlow internal state
  useEffect(() => {
    setNodes(runtimeNodes);
  }, [runtimeNodes, setNodes]);

  useEffect(() => {
    setEdges(runtimeEdges);
  }, [runtimeEdges, setEdges]);

  return (
    <div className="h-full w-full bg-[#09090b]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background gap={24} color="#27272a" />
        <Controls className="!bg-black/50" />
        <MiniMap className="!bg-black/50" />
      </ReactFlow>
    </div>
  );
}
