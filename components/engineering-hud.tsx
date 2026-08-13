'use client'

import { Activity, ChevronRight, ScrollText, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AGENTS } from '@/lib/data'
import { SCENARIOS } from '@/lib/scenarios'
import { useKlyn } from '@/lib/store'
import type { LogLevel } from '@/lib/types'

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: 'text-foreground/80',
  agent: 'text-neural-dim',
  success: 'text-neural',
  warn: 'text-foreground',
  error: 'text-critical',
  system: 'text-muted',
}

const TABS = [
  { id: 'terminal' as const, label: 'Terminal', icon: SquareTerminal },
  { id: 'agents' as const, label: 'Agents', icon: Activity },
  { id: 'logs' as const, label: 'Logs', icon: ScrollText },
]

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

export function EngineeringHud() {
  const hudOpen = useKlyn((s) => s.hudOpen)
  const hudTab = useKlyn((s) => s.hudTab)
  const setHudTab = useKlyn((s) => s.setHudTab)
  const toggleHud = useKlyn((s) => s.toggleHud)
  const logs = useKlyn((s) => s.logs)
  const agents = useKlyn((s) => s.agents)
  const pushLog = useKlyn((s) => s.pushLog)
  const runScenario = useKlyn((s) => s.runScenario)

  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([
    'klyn v4.2.0 — engineering terminal. Type "help" for commands.',
  ])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, history, hudTab, hudOpen])

  const runCommand = (raw: string) => {
    const cmd = raw.trim().toLowerCase()
    const echo = `klyn > ${raw}`
    const out: string[] = [echo]

    if (cmd === 'help') {
      out.push(
        'commands: agents · status · deploy · optimize · audit · auth · memory · clear',
        'intents can also be dispatched with Cmd+K',
      )
    } else if (cmd === 'agents') {
      for (const a of AGENTS) {
        const st = agents[a.id]
        out.push(`${a.label.padEnd(12)} ${st?.status ?? 'idle'}${st?.task ? ` — ${st.task}` : ''}`)
      }
    } else if (cmd === 'status') {
      out.push('web client: healthy · gateway: healthy · agent runtime: healthy', 'neural store: 2.4M vectors · deploy plane: v4.2.0 (prod)')
    } else if (cmd === 'clear') {
      setHistory([])
      setInput('')
      return
    } else if (cmd === 'deploy') {
      out.push('dispatching intent: deploy production')
      runScenario('deploy-production')
    } else if (cmd === 'optimize') {
      out.push('dispatching intent: optimize database')
      runScenario('optimize-database')
    } else if (cmd === 'audit') {
      out.push('dispatching intent: find security issues')
      runScenario('security-audit')
    } else if (cmd === 'auth') {
      out.push('dispatching intent: create authentication system')
      runScenario('create-auth')
    } else if (cmd === 'memory') {
      useKlyn.getState().setMemoryOpen(true)
      out.push('neural memory panel opened')
    } else if (cmd.length > 0) {
      out.push(`unknown command: "${cmd}" — routing to brain as natural language intent`)
      pushLog('system', 'brain', `Unstructured intent received via terminal: "${raw}"`)
    }

    setHistory((h) => [...h.slice(-100), ...out])
    setInput('')
  }

  if (!hudOpen) return null

  return (
    <section
      className="glass fixed right-4 bottom-4 left-4 z-40 flex h-64 animate-fade-up flex-col rounded-lg shadow-[0_24px_80px_rgba(0,0,0,0.55)] md:left-auto md:w-[min(720px,calc(100vw-2rem))]"
      aria-label="Engineering HUD"
    >
      <header className="flex items-center border-b border-border-glass px-2">
        <div className="flex flex-1 items-center">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setHudTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 font-mono text-[11px] transition-colors ${
                hudTab === t.id
                  ? 'border-b border-neural text-neural'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              <t.icon className="size-3.5" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
        <span className="mr-2 hidden font-mono text-[10px] text-muted sm:block">{'toggle with ~'}</span>
        <button
          type="button"
          onClick={toggleHud}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-neural/10 hover:text-neural"
          aria-label="Close HUD"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed">
        {hudTab === 'terminal' && (
          <>
            {history.map((line, i) => (
              <p key={i} className={line.startsWith('klyn >') ? 'text-neural-dim' : 'text-foreground/80'}>
                {line}
              </p>
            ))}
          </>
        )}

        {hudTab === 'logs' &&
          logs.map((log) => (
            <p key={log.id} className="flex gap-2">
              <span className="shrink-0 text-muted">{formatTime(log.ts)}</span>
              <span className="w-16 shrink-0 text-neural-dim">[{log.source}]</span>
              <span className={LEVEL_COLORS[log.level]}>{log.message}</span>
            </p>
          ))}

        {hudTab === 'agents' && (
          <div className="flex flex-col gap-2">
            {AGENTS.map((a) => {
              const st = agents[a.id]
              const busy = st && st.status !== 'idle'
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <span className={`size-1.5 shrink-0 rounded-full ${busy ? 'animate-pulse bg-neural' : 'bg-muted'}`} />
                  <span className="w-24 shrink-0 text-foreground/90">{a.label}</span>
                  <span className={`w-20 shrink-0 uppercase tracking-wider ${busy ? 'text-neural' : 'text-muted'}`}>
                    {st?.status ?? 'idle'}
                  </span>
                  <span className="flex-1 truncate text-muted">{st?.task ?? a.role}</span>
                  {busy ? <span className="text-neural-dim">{st.progress}%</span> : null}
                </div>
              )
            })}
            <p className="mt-2 text-muted">
              dispatch work via Cmd+K — e.g. {SCENARIOS.map((s) => `"${s.title.toLowerCase()}"`).join(' · ')}
            </p>
          </div>
        )}
      </div>

      {hudTab === 'terminal' && (
        <form
          className="flex items-center gap-2 border-t border-border-glass px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            runCommand(input)
          }}
        >
          <ChevronRight className="size-3.5 shrink-0 text-neural" aria-hidden="true" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="run a command or describe an intent…"
            className="w-full bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted"
            aria-label="Terminal input"
          />
        </form>
      )}
    </section>
  )
}
