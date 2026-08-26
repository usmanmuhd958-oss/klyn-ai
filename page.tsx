// apps/web/app/(shell)/agents/page.tsx

'use client'

import { useAgentStore } from '@klyn/store'
import { AgentCard } from '@klyn/ui/agents'
import { AgentInteractionGraph } from '@klyn/ui/agents'
import { AgentTimeline } from '@klyn/ui/agents'

export default function AgentCivilizationPage() {
  const agents = useAgentStore(s => Object.values(s.agents))
  const activeAgentId = useAgentStore(s => s.activeAgentId)

  return (
    <div className="h-full grid grid-cols-[300px_1fr_320px] gap-0">
      {/* Left: Agent roster */}
      <div className="border-r border-klyn-border overflow-y-auto p-4 space-y-3">
        <h2 className="text-xs font-semibold text-klyn-muted uppercase tracking-widest mb-4">
          Engineering Organization
        </h2>
        {agents.map(agent => (
          <AgentCard key={agent.identity.id} agent={agent} />
        ))}
      </div>

      {/* Center: Agent interaction graph + timeline */}
      <div className="flex flex-col">
        <AgentInteractionGraph agents={agents} />
        <div className="border-t border-klyn-border flex-1">
          <AgentTimeline agents={agents} />
        </div>
      </div>

      {/* Right: Selected agent detail */}
      {activeAgentId && (
        <AgentDetailPanel agentId={activeAgentId} />
      )}
    </div>
  )
}