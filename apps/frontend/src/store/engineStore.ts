import { create } from 'zustand';
import type { AgentRole, EngineeringTask } from '../lib/taskDag';

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

export interface ArchitectureDecisionRecord {
  id: string;
  title: string;
  decision: string;
  justification: string;
  constraints: string[];
  status: 'proposed' | 'accepted' | 'superseded';
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
  role: AgentRole;
  description: string;
  status: 'idle' | 'working';
  currentTask: string | null;
}

interface EngineState {
  digitalTwin: TwinModule[];
  architectureMemory: ArchitectureMemoryEntry[];
  decisionMemory: ArchitectureDecisionRecord[];
  predictiveSignals: PredictiveSignal[];
  agents: AgentDescriptor[];
  deepModeOpen: boolean;
  activeAgentCount: () => number;
  setDeepMode: (open: boolean) => void;
  recordAdr: (adr: Omit<ArchitectureDecisionRecord, 'id' | 'timestamp'>) => void;
  synthesizeConnection: (sourceId: string, targetId: string) => void;
  onIntentSubmitted: (intent: string) => void;
  onTasksChanged: (tasks: EngineeringTask[]) => void;
  onRunCompleted: (intent: string) => void;
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
  { id: 'architect', name: 'Architect', role: 'planner', description: 'System design & decomposition', status: 'idle', currentTask: null },
  { id: 'builder', name: 'Builder', role: 'builder', description: 'Code synthesis', status: 'idle', currentTask: null },
  { id: 'verifier', name: 'Verifier', role: 'validator', description: 'Constraint & behavior validation', status: 'idle', currentTask: null },
  { id: 'shipper', name: 'Shipper', role: 'shipper', description: 'Delivery orchestration', status: 'idle', currentTask: null },
];

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

  recordAdr: (adr) =>
    set((state) => ({
      decisionMemory: [
        { ...adr, id: crypto.randomUUID(), timestamp: Date.now() },
        ...state.decisionMemory,
      ].slice(0, 50),
    })),

  synthesizeConnection: (sourceId, targetId) => {
    const twin = get().digitalTwin;
    const source = twin.find((m) => m.id === sourceId);
    const target = twin.find((m) => m.id === targetId);
    if (!source || !target || sourceId === targetId) return;
    if (source.dependsOn.includes(targetId)) return;

    set((state) => ({
      digitalTwin: state.digitalTwin.map((m) =>
        m.id === sourceId ? { ...m, dependsOn: [...m.dependsOn, targetId] } : m
      ),
    }));
    get().recordAdr({
      title: `Link ${source.name} → ${target.name}`,
      decision: `Synthesized integration from ${source.name} to ${target.name}`,
      justification: 'Connection drawn on Engineering Canvas; code synthesis orchestrated to bind the modules',
      constraints: ['No circular dependency introduced', 'Interface contract preserved'],
      status: 'accepted',
    });
  },

  onIntentSubmitted: (intent) =>
    get().recordAdr({
      title: `Intent: ${intent}`,
      decision: `Accepted intent "${intent}" for autonomous decomposition`,
      justification: 'Intent matched active project scope and safety policy',
      constraints: ['Blast radius bounded to affected modules', 'All changes validated before ship'],
      status: 'accepted',
    }),

  onTasksChanged: (tasks) =>
    set((state) => ({
      agents: state.agents.map((agent) => {
        const running = tasks.find((t) => t.status === 'running' && t.agent === agent.role);
        return running
          ? { ...agent, status: 'working' as const, currentTask: running.title }
          : { ...agent, status: 'idle' as const, currentTask: null };
      }),
    })),

  onRunCompleted: (intent) => {
    set((state) => ({
      architectureMemory: [
        {
          id: crypto.randomUUID(),
          summary: `Learned from "${intent}": execution DAG archived to memory`,
          timestamp: Date.now(),
        },
        ...state.architectureMemory,
      ].slice(0, 50),
    }));
    get().recordAdr({
      title: `Outcome: ${intent}`,
      decision: `Fulfilled "${intent}" via multi-agent DAG execution`,
      justification: 'All tasks validated in sandbox before delivery; outcome archived for future constraint reasoning',
      constraints: ['ADR supersedable by future intents'],
      status: 'accepted',
    });
  },
}));
