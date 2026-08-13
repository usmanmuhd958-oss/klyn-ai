'use client'

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import {
  Cloud,
  Database,
  FlaskConical,
  Globe,
  Network,
  Server,
  FileCode2,
} from 'lucide-react'
import { memo } from 'react'
import { useKlyn } from '@/lib/store'
import type { SystemNodeData, NodeStatus } from '@/lib/types'

const KIND_ICONS = {
  frontend: Globe,
  backend: Server,
  database: Database,
  api: Network,
  deployment: Cloud,
  testing: FlaskConical,
} as const

const STATUS_STYLES: Record<NodeStatus, { dot: string; label: string }> = {
  healthy: { dot: 'bg-neural', label: 'healthy' },
  active: { dot: 'bg-neural animate-pulse', label: 'agent active' },
  warning: { dot: 'bg-critical animate-pulse', label: 'attention' },
  building: { dot: 'bg-foreground/70 animate-pulse', label: 'building' },
  idle: { dot: 'bg-muted', label: 'idle' },
}

function SystemNodeComponent({ id, data, selected }: NodeProps<Node<SystemNodeData>>) {
  const status = useKlyn((s) => s.nodeStatus[id] ?? 'healthy')
  const openEditor = useKlyn((s) => s.openEditor)
  const Icon = KIND_ICONS[data.kind]
  const statusStyle = STATUS_STYLES[status]
  const isActive = status === 'active' || status === 'building'

  return (
    <div
      className={`glass relative w-56 rounded-lg transition-all duration-300 ${
        selected ? 'border-neural/50' : ''
      } ${isActive ? 'animate-pulse-glow' : ''} ${status === 'warning' ? 'border-critical/40' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="flex items-center gap-2.5 border-b border-border-glass px-3.5 py-2.5">
        <Icon className="size-4 text-neural" aria-hidden="true" />
        <span className="flex-1 truncate text-sm font-medium text-foreground">{data.label}</span>
        <span className="flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${statusStyle.dot}`} />
          <span className="sr-only">{statusStyle.label}</span>
        </span>
      </div>

      <div className="px-3.5 py-2.5">
        <p className="font-mono text-[10px] tracking-wide text-muted">{data.detail}</p>
        <div className="mt-2.5 flex gap-4">
          {data.metrics.map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted">{m.label}</span>
              <span className="font-mono text-xs text-neural-dim">{m.value}</span>
            </div>
          ))}
        </div>
      </div>

      {data.fileId ? (
        <button
          type="button"
          onClick={() => openEditor(data.fileId!)}
          className="flex w-full items-center gap-1.5 border-t border-border-glass px-3.5 py-2 font-mono text-[10px] text-muted transition-colors hover:bg-neural/5 hover:text-neural"
        >
          <FileCode2 className="size-3" aria-hidden="true" />
          open code intelligence
        </button>
      ) : null}
    </div>
  )
}

export const SystemNode = memo(SystemNodeComponent)
