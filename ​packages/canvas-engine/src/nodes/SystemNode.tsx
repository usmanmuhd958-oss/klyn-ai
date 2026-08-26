// packages/canvas-engine/src/nodes/SystemNode.tsx

import { memo, useState } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { useAgentStore } from '@klyn/store'
import { NodeMetadata } from '../types/canvas.types'

export interface SystemNodeData {
  label: string
  type: 'frontend' | 'backend' | 'database' | 'api' | 'queue' | 'infra' | 'external'
  status: 'planning' | 'building' | 'testing' | 'running' | 'error'
  agentOwner?: string           // Agent ID
  health?: number               // 0-100
  metrics?: {
    requests?: number
    latency?: number
    errors?: number
  }
  intentAnchor?: string         // Intent that created this node
  codeFiles?: string[]          // Files this node maps to
  metadata: NodeMetadata
}

const NODE_COLORS: Record<SystemNodeData['type'], string> = {
  frontend:  'border-blue-400/50 bg-blue-950/30',
  backend:   'border-emerald-400/50 bg-emerald-950/30',
  database:  'border-amber-400/50 bg-amber-950/30',
  api:       'border-purple-400/50 bg-purple-950/30',
  queue:     'border-orange-400/50 bg-orange-950/30',
  infra:     'border-slate-400/50 bg-slate-950/30',
  external:  'border-zinc-400/50 bg-zinc-950/30',
}

export const SystemNode = memo(({ data, selected }: NodeProps<SystemNodeData>) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const agent = useAgentStore(s => 
    data.agentOwner ? s.agents[data.agentOwner] : null
  )

  return (
    <div className={`
      klyn-node relative rounded-xl border-2 backdrop-blur-sm
      min-w-[160px] cursor-pointer transition-all duration-200
      ${NODE_COLORS[data.type]}
      ${selected ? 'ring-2 ring-klyn-accent shadow-lg shadow-klyn-accent/20' : ''}
      ${data.status === 'error' ? 'animate-pulse-error' : ''}
    `}>
      {/* Agent ownership indicator */}
      {agent && (
        <div className="absolute -top-3 -right-3 flex items-center gap-1">
          <AgentBadge agent={agent} size="sm" />
        </div>
      )}

      {/* Status indicator */}
      <StatusDot status={data.status} />

      {/* Node header */}
      <div className="p-3">
        <div className="flex items-center gap-2">
          <NodeTypeIcon type={data.type} />
          <span className="text-sm font-semibold text-white/90">{data.label}</span>
        </div>

        {/* Health bar */}
        {data.health !== undefined && (
          <div className="mt-2 h-1 rounded-full bg-white/10">
            <div 
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${data.health}%` }}
            />
          </div>
        )}

        {/* Expandable metrics */}
        {isExpanded && data.metrics && (
          <div className="mt-2 text-xs text-white/60 space-y-1">
            {data.metrics.requests !== undefined && (
              <div>{data.metrics.requests.toLocaleString()} req/s</div>
            )}
            {data.metrics.latency !== undefined && (
              <div>{data.metrics.latency}ms p99</div>
            )}
          </div>
        )}
      </div>

      {/* Connection handles */}
      <Handle type="target" position={Position.Left} className="klyn-handle" />
      <Handle type="source" position={Position.Right} className="klyn-handle" />
      <Handle type="target" position={Position.Top} className="klyn-handle" />
      <Handle type="source" position={Position.Bottom} className="klyn-handle" />
    </div>
  )
})