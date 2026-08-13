'use client'

import { Search, SquareTerminal, Waypoints } from 'lucide-react'
import { AGENTS } from '@/lib/data'
import { useKlyn } from '@/lib/store'

export function TopBar() {
  const setPaletteOpen = useKlyn((s) => s.setPaletteOpen)
  const toggleHud = useKlyn((s) => s.toggleHud)
  const setMemoryOpen = useKlyn((s) => s.setMemoryOpen)
  const memoryOpen = useKlyn((s) => s.memoryOpen)
  const agents = useKlyn((s) => s.agents)
  const runningScenario = useKlyn((s) => s.runningScenario)

  const busyCount = AGENTS.filter((a) => agents[a.id]?.status !== 'idle').length

  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-40 flex items-center justify-between gap-3 p-4">
      <div className="glass pointer-events-auto flex items-center gap-3 rounded-lg px-3.5 py-2">
        <span className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className={`absolute inline-flex size-full rounded-full bg-neural ${runningScenario ? 'animate-ping' : ''} opacity-60`} />
            <span className="relative inline-flex size-2 rounded-full bg-neural" />
          </span>
          <span className="text-sm font-semibold tracking-[0.2em] text-foreground">KLYN</span>
        </span>
        <span className="hidden h-4 w-px bg-border-glass sm:block" />
        <span className="hidden font-mono text-[10px] tracking-wide text-muted sm:block">
          {runningScenario
            ? `${busyCount} agent${busyCount === 1 ? '' : 's'} working`
            : 'autonomous engineering environment'}
        </span>
      </div>

      <nav className="pointer-events-auto flex items-center gap-2" aria-label="Environment controls">
        <button
          type="button"
          onClick={() => setMemoryOpen(!memoryOpen)}
          className={`glass flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-[11px] transition-colors hover:text-neural ${
            memoryOpen ? 'text-neural' : 'text-muted'
          }`}
        >
          <Waypoints className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">memory</span>
        </button>
        <button
          type="button"
          onClick={toggleHud}
          className="glass flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-[11px] text-muted transition-colors hover:text-neural"
        >
          <SquareTerminal className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">hud</span>
          <kbd className="rounded border border-border-glass px-1 text-[9px]">~</kbd>
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="glass flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-[11px] text-foreground/90 transition-colors hover:text-neural"
        >
          <Search className="size-3.5 text-neural" aria-hidden="true" />
          <span className="hidden sm:inline">command anything</span>
          <kbd className="rounded border border-border-glass px-1 text-[9px]">{'\u2318K'}</kbd>
        </button>
      </nav>
    </header>
  )
}
