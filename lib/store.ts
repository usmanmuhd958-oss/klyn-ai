'use client'

import { create } from 'zustand'
import { AGENTS } from './data'
import { getScenario } from './scenarios'
import type { AgentState, LogEntry, LogLevel, NodeStatus } from './types'

let logCounter = 0

interface KlynState {
  paletteOpen: boolean
  hudOpen: boolean
  hudTab: 'terminal' | 'agents' | 'logs'
  memoryOpen: boolean
  editorFileId: string | null
  logs: LogEntry[]
  agents: Record<string, AgentState>
  nodeStatus: Record<string, NodeStatus>
  runningScenario: string | null
  acceptedSuggestions: Record<string, boolean>

  setPaletteOpen: (open: boolean) => void
  toggleHud: () => void
  setHudTab: (tab: KlynState['hudTab']) => void
  setMemoryOpen: (open: boolean) => void
  openEditor: (fileId: string | null) => void
  pushLog: (level: LogLevel, source: string, message: string) => void
  acceptSuggestion: (fileId: string) => void
  runScenario: (id: string) => void
}

const initialAgents: Record<string, AgentState> = Object.fromEntries(
  AGENTS.map((a) => [a.id, { status: 'idle' as const, task: null, progress: 0 }]),
)

export const useKlyn = create<KlynState>((set, get) => ({
  paletteOpen: false,
  hudOpen: false,
  hudTab: 'terminal',
  memoryOpen: false,
  editorFileId: null,
  logs: [
    {
      id: 'boot-1',
      ts: Date.now(),
      level: 'system',
      source: 'kernel',
      message: 'KLYN engineering environment online — 6 agents standing by',
    },
    {
      id: 'boot-2',
      ts: Date.now(),
      level: 'info',
      source: 'memory',
      message: 'Neural memory synced: 2.4M vectors, 1,842 engineering decisions',
    },
  ],
  agents: initialAgents,
  nodeStatus: {},
  runningScenario: null,
  acceptedSuggestions: {},

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  toggleHud: () => set((s) => ({ hudOpen: !s.hudOpen })),
  setHudTab: (tab) => set({ hudTab: tab }),
  setMemoryOpen: (open) => set({ memoryOpen: open }),
  openEditor: (fileId) => set({ editorFileId: fileId }),

  pushLog: (level, source, message) =>
    set((s) => ({
      logs: [
        ...s.logs.slice(-199),
        { id: `log-${++logCounter}`, ts: Date.now(), level, source, message },
      ],
    })),

  acceptSuggestion: (fileId) => {
    set((s) => ({ acceptedSuggestions: { ...s.acceptedSuggestions, [fileId]: true } }))
    get().pushLog('success', 'editor', `Suggestion accepted and applied to ${fileId}`)
  },

  runScenario: (id) => {
    const scenario = getScenario(id)
    if (!scenario || get().runningScenario) return

    set({ runningScenario: id, paletteOpen: false, hudOpen: true, hudTab: 'logs' })

    let elapsed = 0
    for (const step of scenario.steps) {
      elapsed += step.delay
      setTimeout(() => {
        if (step.log) get().pushLog(step.log.level, step.log.source, step.log.message)
        if (step.agent) {
          set((s) => ({
            agents: {
              ...s.agents,
              [step.agent!.id]: {
                status: step.agent!.status,
                task: step.agent!.task !== undefined ? step.agent!.task : s.agents[step.agent!.id]?.task ?? null,
                progress: step.agent!.progress ?? s.agents[step.agent!.id]?.progress ?? 0,
              },
            },
          }))
        }
        if (step.node) {
          set((s) => ({ nodeStatus: { ...s.nodeStatus, [step.node!.id]: step.node!.status } }))
        }
        if (step.openFile) {
          set({ editorFileId: step.openFile })
        }
      }, elapsed)
    }

    setTimeout(() => set({ runningScenario: null }), elapsed + 500)
  },
}))
