import { create } from 'zustand';
import type { ExecutionPhase } from '../lib/phases';

export interface TwinModule {
  id: string;
  name: string;
  kind: 'service' | 'library' | 'agent' | 'datastore';
  health: number;
  dependsOn: string[];
}

export interface ArchitectureMemoryEntry {
  id: string;
  summary: string;
  timestamp: number;
}

export interface DecisionMemoryEntry {
  id: string;
  decision: string;
  rationale: string;
  timestamp: number;
}

export interface PredictiveSignal {
  id: string;
  signal: string;
  confidence: number;
  severity: 'info' | 'watch' | 'critical';
}

export interface AgentDescriptor {
  id: string;
  name: string;
  role: string;
  status: 'idle' | 'working';
}

interface EngineState {
  digitalTwin: TwinModule[];
  architectureMemory: ArchitectureMemoryEntry[];
  decisionMemory: DecisionMemoryEntry[];
  predictiveSignals: PredictiveSignal[];
  agents: AgentDescriptor[];
  deepModeOpen: boolean;
  activeAgentCount: () => number;
  setDeepMode: (open: boolean) => void;
  onIntentSubmitted: (intent: string) => void;
  onPhaseCompleted: (phase: ExecutionPhase, intent: string) => void;
}

const seedTwin: TwinModule[] = [
  { id: 'kernel', name: 'Neural Kernel', kind: 'service', health: 0.98, dependsOn: [] },
  { id: 'brain', name: 'Reasoning Brain', kind: 'agent', health: 0.94, dependsOn: ['kernel'] },
  { id: 'memory', name: 'Vector Context Fabric', kind: 'datastore', health: 0.97, dependsOn: ['kernel'] },
  { id: 'runtime', name: 'Sandboxed Runtime', kind: 'service', health: 0.91, dependsOn: ['kernel', 'brain'] },
  { id: 'gateway', name: 'LLM Gateway', kind: 'library', health: 0.99, dependsOn: ['brain'] },
  { id: 'pipeline', name: 'Delivery Pipeline', kind: 'service', health: 0.95, dependsOn: ['runtime'] },
];

const seedAgents: AgentDescriptor[] = [
  { id: 'architect', name: 'Architect', role: 'System design', status: 'idle' },
  { id: 'builder', name: 'Builder', role: 'Code synthesis', status: 'idle' },
  { id: 'verifier', name: 'Verifier', role: 'Testing & QA', status: 'idle' },
  { id: 'shipper', name: 'Shipper', role: 'Deployment', status: 'idle' },
];

const AGENT_FOR_NEXT_PHASE: Partial<Record<ExecutionPhase, string>> = {
  Thinking: 'architect',
  Planning: 'builder',
  Building: 'verifier',
  Testing: 'shipper',
};

export const useEngineStore = create<EngineState>((set, get) => ({
  digitalTwin: seedTwin,
  architectureMemory: [],
  decisionMemory: [],
  predictiveSignals: [
    { id: 'sig-1', signal: 'Runtime latency trending up in sandbox pool', confidence: 0.71, severity: 'watch' },
    { id: 'sig-2', signal: 'Vector fabric compaction due within 24h', confidence: 0.88, severity: 'info' },
  ],
  agents: seedAgents,
  deepModeOpen: false,

  activeAgentCount: () => get().agents.filter((a) => a.status === 'working').length,

  setDeepMode: (open) => set({ deepModeOpen: open }),

  onIntentSubmitted: (intent) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === AGENT_FOR_NEXT_PHASE.Thinking ? { ...a, status: 'working' } : a
      ),
      decisionMemory: [
        {
          id: crypto.randomUUID(),
          decision: `Accepted intent: "${intent}"`,
          rationale: 'Intent matched active project scope and safety policy',
          timestamp: Date.now(),
        },
        ...state.decisionMemory,
      ].slice(0, 50),
    })),

  onPhaseCompleted: (phase, intent) =>
    set((state) => {
      const nextAgentId = AGENT_FOR_NEXT_PHASE[phase];
      const agents = state.agents.map((a) => {
        if (!nextAgentId) return { ...a, status: 'idle' as const };
        return { ...a, status: a.id === nextAgentId ? ('working' as const) : ('idle' as const) };
      });

      const architectureMemory =
        phase === 'Learning'
          ? [
              {
                id: crypto.randomUUID(),
                summary: `Learned from "${intent}": execution graph archived to memory`,
                timestamp: Date.now(),
              },
              ...state.architectureMemory,
            ].slice(0, 50)
          : state.architectureMemory;

      return { agents, architectureMemory };
    }),
}));
