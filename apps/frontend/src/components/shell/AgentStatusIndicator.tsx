'use client';

import { useEngineStore } from '../../store/engineStore';

export function AgentStatusIndicator() {
  const agents = useEngineStore((s) => s.agents);
  const working = agents.filter((a) => a.status === 'working');
  const active = working.length > 0;

  return (
    <div
      className="fixed right-6 top-6 flex items-center gap-2 rounded-full border border-neutral-800/80 bg-neutral-900/70 px-3 py-1.5 backdrop-blur"
      title={active ? working.map((a) => `${a.name} — ${a.role}`).join('\n') : 'All agents idle'}
    >
      <span className="relative flex h-2 w-2">
        {active && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-neutral-600'}`}
        />
      </span>
      <span className="text-xs text-neutral-500">
        {active ? `${working.length} agent${working.length > 1 ? 's' : ''} active` : 'idle'}
      </span>
    </div>
  );
}
