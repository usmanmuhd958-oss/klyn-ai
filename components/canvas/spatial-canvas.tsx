'use client'

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { INITIAL_EDGES, INITIAL_NODES } from '@/lib/data'
import { AgentNode } from './agent-node'
import { SystemNode } from './system-node'

export function SpatialCanvas() {
  const [nodes, , onNodesChange] = useNodesState(INITIAL_NODES)
  const [edges, , onEdgesChange] = useEdgesState(INITIAL_EDGES)

  const nodeTypes = useMemo(() => ({ system: SystemNode, agent: AgentNode }), [])

  return (
    <div className="absolute inset-0" aria-label="Spatial engineering canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.3}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="rgba(102, 252, 241, 0.14)"
        />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          position="top-right"
          nodeColor="rgba(102, 252, 241, 0.25)"
          maskColor="rgba(11, 12, 16, 0.7)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}
