'use client'

import { Command } from 'cmdk'
import { BrainCircuit, SquareTerminal, Sparkles, Waypoints } from 'lucide-react'
import { useEffect } from 'react'
import { SCENARIOS } from '@/lib/scenarios'
import { useKlyn } from '@/lib/store'

export function CommandPalette() {
  const paletteOpen = useKlyn((s) => s.paletteOpen)
  const setPaletteOpen = useKlyn((s) => s.setPaletteOpen)
  const runScenario = useKlyn((s) => s.runScenario)
  const runningScenario = useKlyn((s) => s.runningScenario)
  const setMemoryOpen = useKlyn((s) => s.setMemoryOpen)
  const memoryOpen = useKlyn((s) => s.memoryOpen)
  const toggleHud = useKlyn((s) => s.toggleHud)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen(!useKlyn.getState().paletteOpen)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  if (!paletteOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 pt-[18vh] backdrop-blur-sm"
      onClick={() => setPaletteOpen(false)}
      role="presentation"
    >
      <div
        className="glass w-full max-w-xl animate-fade-up rounded-lg shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Ambient command intelligence"
      >
        <Command label="Ambient command intelligence" loop>
          <div className="flex items-center gap-2.5 border-b border-border-glass px-4">
            <Sparkles className="size-4 shrink-0 text-neural" aria-hidden="true" />
            <Command.Input
              autoFocus
              placeholder="Describe an engineering intent…"
              className="h-12 w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted"
            />
            <kbd className="shrink-0 rounded border border-border-glass px-1.5 py-0.5 font-mono text-[10px] text-muted">
              esc
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center font-mono text-xs text-muted">
              No matching intent. Agents can still try — press an example below.
            </Command.Empty>

            <Command.Group
              heading="Engineering intents"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted"
            >
              {SCENARIOS.map((s) => (
                <Command.Item
                  key={s.id}
                  value={s.title}
                  disabled={!!runningScenario}
                  onSelect={() => runScenario(s.id)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground/90 data-[disabled=true]:opacity-40"
                >
                  <BrainCircuit className="size-4 shrink-0 text-neural-dim" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="block">{s.title}</span>
                    <span className="block font-mono text-[10px] text-muted">{s.hint}</span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Environment"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted"
            >
              <Command.Item
                value="Open neural memory"
                onSelect={() => {
                  setMemoryOpen(!memoryOpen)
                  setPaletteOpen(false)
                }}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground/90"
              >
                <Waypoints className="size-4 shrink-0 text-neural-dim" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block">{memoryOpen ? 'Close neural memory' : 'Open neural memory'}</span>
                  <span className="block font-mono text-[10px] text-muted">
                    Decision history, learned patterns, agent evolution
                  </span>
                </span>
              </Command.Item>
              <Command.Item
                value="Toggle engineering HUD"
                onSelect={() => {
                  toggleHud()
                  setPaletteOpen(false)
                }}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground/90"
              >
                <SquareTerminal className="size-4 shrink-0 text-neural-dim" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block">Toggle engineering HUD</span>
                  <span className="block font-mono text-[10px] text-muted">
                    {'Terminal, logs, agent activity — shortcut ~'}
                  </span>
                </span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          <div className="flex items-center gap-4 border-t border-border-glass px-4 py-2">
            <span className="font-mono text-[10px] text-muted">
              <kbd className="text-neural-dim">{'\u2191\u2193'}</kbd> navigate
            </span>
            <span className="font-mono text-[10px] text-muted">
              <kbd className="text-neural-dim">{'\u21B5'}</kbd> dispatch to agents
            </span>
          </div>
        </Command>
      </div>
    </div>
  )
}
