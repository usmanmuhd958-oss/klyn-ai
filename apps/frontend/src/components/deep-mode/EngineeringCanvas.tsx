'use client';

import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEngineStore } from '../../store/engineStore';
import { NodeInspector } from './NodeInspector';

const moduleStyle = (health: number) => ({
  background: '#111113',
  color: '#e5e5e5',
  border: `1px solid ${health > 0.95 ? '#34d39955' : health > 0.9 ? '#fbbf2455' : '#f8717155'}`,
  borderRadius: 12,
  fontSize: 12,
  padding: 10,
});

const agentStyle = {
  background: '#0c1512',
  color: '#a7f3d0',
  border: '1px solid #10b98144',
  borderRadius: 999,
  fontSize: 11,
  padding: 8,
};

const memoryStyle = {
  background: '#0f0d15',
  color: '#c4b5fd',
  border: '1px solid #8b5cf644',
  borderRadius: 12,
  fontSize: 11,
  padding: 8,
};

export function EngineeringCanvas() {
  const digitalTwin = useEngineStore((s) => s.digitalTwin);
  const agents = useEngineStore((s) => s.agents);
  const architectureMemory = useEngineStore((s) => s.architectureMemory);
  const decisionMemory = useEngineStore((s) => s.decisionMemory);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = digitalTwin.map((mod, i) => ({
      id: mod.id,
      position: { x: 80 + (i % 3) * 260, y: 60 + Math.floor(i / 3) * 160 },
      data: { label: `${mod.name} · ${(mod.health * 100).toFixed(0)}%` },
      style: moduleStyle(mod.health),
    }));

    agents.forEach((agent, i) => {
      nodes.push({
        id: `agent-${agent.id}`,
        position: { x: 880, y: 40 + i * 90 },
        data: { label: `${agent.name} ${agent.status === 'working' ? '●' : '○'}` },
        style: agentStyle,
      });
    });

    nodes.push({
      id: 'memory-architecture',
      position: { x: 80, y: 420 },
      data: { label: `Architecture Memory · ${architectureMemory.length} entries` },
      style: memoryStyle,
    });
    nodes.push({
      id: 'memory-decision',
      position: { x: 360, y: 420 },
      data: { label: `Decision Memory · ${decisionMemory.length} entries` },
      style: memoryStyle,
    });

    const edges: Edge[] = digitalTwin.flatMap((mod) =>
      mod.dependsOn.map((dep) => ({
        id: `${mod.id}->${dep}`,
        source: mod.id,
        target: dep,
        animated: true,
        style: { stroke: '#3f3f46' },
      }))
    );
    edges.push(
      { id: 'mem-a', source: 'memory-architecture', target: 'memory', style: { stroke: '#8b5cf644' } },
      { id: 'mem-d', source: 'memory-decision', target: 'brain', style: { stroke: '#8b5cf644' } }
    );
    agents.forEach((agent) => {
      edges.push({
        id: `agent-${agent.id}->runtime`,
        source: `agent-${agent.id}`,
        target: 'runtime',
        animated: agent.status === 'working',
        style: { stroke: '#10b98133' },
      });
    });

    return { nodes, edges };
  }, [digitalTwin, agents, architectureMemory.length, decisionMemory.length]);

  const onNodeClick: NodeMouseHandler = (_, node) => setSelectedId(node.id);

  return (
    <div className="flex h-full w-full">
      <div className="h-full flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background color="#27272a" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selectedId && (
        <NodeInspector nodeId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
