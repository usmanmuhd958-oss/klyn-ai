'use client'

import { useEffect } from 'react'
import { CommandPalette } from './command-palette'
import { EngineeringHud } from './engineering-hud'
import { IntelligenceEditor } from './intelligence-editor'
import { MemoryPanel } from './memory-panel'
import { SpatialCanvas } from './canvas/spatial-canvas'
import { TopBar } from './top-bar'
import { useKlyn } from '@/lib/store'

export function Workspace() {
  const toggleHud = useKlyn((s) => s.toggleHud)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing) return
      if (e.key === '`' || e.key === '~') {
        e.preventDefault()
        toggleHud()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleHud])

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background">
      <h1 className="sr-only">KLYN — Autonomous Engineering Platform</h1>

      <SpatialCanvas />
      <TopBar />
      <MemoryPanel />
      <IntelligenceEditor />
      <EngineeringHud />
      <CommandPalette />

      <footer className="pointer-events-none fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
        <p className="glass rounded-full px-4 py-1.5 font-mono text-[10px] text-muted">
          <kbd className="text-neural-dim">{'\u2318K'}</kbd> command intelligence ·{' '}
          <kbd className="text-neural-dim">~</kbd> engineering hud · drag to explore the project graph
        </p>
      </footer>
    </main>
  )
}
