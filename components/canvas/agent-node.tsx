'use client'

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Bot } from 'lucide-react'
import { memo } from 'react'
import { useKlyn } from '@/lib/store'
import type { AgentNodeData, AgentStatus } from '@/lib/types'

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'standing by',
  planning: 'planning',
  executing: 'executing',
  verifying: 'verifying',
}

function AgentNodeComponent({ data }: NodeProps<Node<AgentNodeData>>) {
  const agent = useKlyn((s) => s.agents[data.agentId])
  const busy = agent && agent.status !== 'idle'

  return (
    <div
      className={`glass relative w-48 rounded-lg transition-all duration-300 ${
        busy ? 'animate-pulse-glow border-neural/40' : 'opacity-80'
      }`}
    >
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Top} />

      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={`flex size-6 items-center justify-center rounded-md ${
            busy ? 'bg-neural/15 text-neural' : 'bg-deep text-muted'
          }`}
        >
          <Bot className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{data.label} Agent</p>
          <p className="truncate font-mono text-[9px] text-muted">{data.role}</p>
        </div>
      </div>

      <div className="border-t border-border-glass px-3 py-1.5">
        <div className="flex items-center justify-between">
          <span className={`font-mono text-[9px] uppercase tracking-widest ${busy ? 'text-neural' : 'text-muted'}`}>
            {STATUS_LABEL[agent?.status ?? 'idle']}
          </span>
          {busy && agent?.progress ? (
            <span className="font-mono text-[9px] text-neural-dim">{agent.progress}%</span>
          ) : null}
        </div>
        {busy && agent?.task ? (
          <p className="mt-0.5 truncate font-mono text-[9px] text-foreground/70">{agent.task}</p>
        ) : null}
        {busy ? (
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-deep">
            <div
              className="h-full rounded-full bg-neural transition-all duration-700"
              style={{ width: `${agent?.progress ?? 0}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const AgentNode = memo(AgentNodeComponent)
