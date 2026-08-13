'use client'

import { GitBranch, Lightbulb, Puzzle, TrendingUp, Waypoints, X } from 'lucide-react'
import { MEMORY_ENTRIES } from '@/lib/data'
import { useKlyn } from '@/lib/store'
import type { MemoryEntry } from '@/lib/types'

const KIND_META: Record<MemoryEntry['kind'], { icon: typeof GitBranch; label: string }> = {
  decision: { icon: GitBranch, label: 'Decision' },
  solution: { icon: Lightbulb, label: 'Solution' },
  pattern: { icon: Puzzle, label: 'Pattern' },
  evolution: { icon: TrendingUp, label: 'Agent evolution' },
}

export function MemoryPanel() {
  const memoryOpen = useKlyn((s) => s.memoryOpen)
  const setMemoryOpen = useKlyn((s) => s.setMemoryOpen)

  if (!memoryOpen) return null

  return (
    <aside
      className="glass fixed top-16 bottom-4 left-4 z-40 flex w-[min(360px,calc(100vw-2rem))] animate-fade-up flex-col rounded-lg shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      aria-label="Neural memory"
    >
      <header className="flex items-center gap-2.5 border-b border-border-glass px-4 py-3">
        <Waypoints className="size-4 shrink-0 text-neural" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="text-sm font-medium text-foreground">Neural Memory</h2>
          <p className="font-mono text-[10px] text-muted">1,842 decisions · 2.4M vectors · learning</p>
        </div>
        <button
          type="button"
          onClick={() => setMemoryOpen(false)}
          className="rounded-md p-1 text-muted transition-colors hover:bg-neural/10 hover:text-neural"
          aria-label="Close neural memory"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ol className="relative flex flex-col gap-1 border-l border-border-glass pl-4">
          {MEMORY_ENTRIES.map((entry) => {
            const meta = KIND_META[entry.kind]
            return (
              <li key={entry.id} className="relative rounded-md p-2.5 transition-colors hover:bg-neural/[0.04]">
                <span className="absolute top-4 -left-[21.5px] size-2 rounded-full border border-neural/50 bg-background" />
                <div className="flex items-center gap-2">
                  <meta.icon className="size-3.5 shrink-0 text-neural-dim" aria-hidden="true" />
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted">{meta.label}</span>
                  <span className="ml-auto font-mono text-[9px] text-muted">{entry.ago}</span>
                </div>
                <h3 className="mt-1.5 text-xs font-medium text-foreground">{entry.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground/60">{entry.detail}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {entry.links.map((link) => (
                    <span
                      key={link}
                      className="rounded border border-border-glass px-1.5 py-0.5 font-mono text-[9px] text-neural-dim"
                    >
                      {link}
                    </span>
                  ))}
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      <footer className="border-t border-border-glass px-4 py-2.5">
        <p className="font-mono text-[10px] leading-relaxed text-muted">
          Every agent action feeds back into memory. KLYN improves with each engineering interaction.
        </p>
      </footer>
    </aside>
  )
}
