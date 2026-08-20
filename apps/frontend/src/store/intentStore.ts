import { create } from 'zustand';
import { EXECUTION_PHASES, type ExecutionPhase, type PhaseStatus } from '../lib/phases';
import { decomposeIntent, readyTasks, type EngineeringTask } from '../lib/taskDag';
import { useEngineStore } from './engineStore';

export interface IntentRun {
  id: string;
  intent: string;
  startedAt: number;
  tasks: EngineeringTask[];
  phases: Record<ExecutionPhase, PhaseStatus>;
  completed: boolean;
}

interface IntentState {
  currentRun: IntentRun | null;
  history: IntentRun[];
  submitIntent: (intent: string) => void;
  tick: () => void;
  reset: () => void;
}

const TICK_MS = 1400;

function derivePhases(tasks: EngineeringTask[]): Record<ExecutionPhase, PhaseStatus> {
  const phases = {} as Record<ExecutionPhase, PhaseStatus>;
  for (const phase of EXECUTION_PHASES) {
    const phaseTasks = tasks.filter((t) => t.phase === phase);
    if (phaseTasks.every((t) => t.status === 'done')) phases[phase] = 'done';
    else if (phaseTasks.some((t) => t.status !== 'pending')) phases[phase] = 'active';
    else phases[phase] = 'pending';
  }
  return phases;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useIntentStore = create<IntentState>((set, get) => ({
  currentRun: null,
  history: [],

  submitIntent: (intent: string) => {
    if (timer) clearTimeout(timer);

    let tasks = decomposeIntent(intent);
    const ready = new Set(readyTasks(tasks).map((t) => t.id));
    tasks = tasks.map((t) => (ready.has(t.id) ? { ...t, status: 'running' as const } : t));
    const run: IntentRun = {
      id: crypto.randomUUID(),
      intent,
      startedAt: Date.now(),
      tasks,
      phases: derivePhases(tasks),
      completed: false,
    };
    set({ currentRun: run });
    useEngineStore.getState().onIntentSubmitted(intent);
    useEngineStore.getState().onTasksChanged(tasks);

    const schedule = () => {
      timer = setTimeout(() => {
        get().tick();
        if (!get().currentRun?.completed) schedule();
      }, TICK_MS);
    };
    schedule();
  },

  tick: () => {
    const run = get().currentRun;
    if (!run || run.completed) return;

    let tasks = run.tasks.map((t) =>
      t.status === 'running' ? { ...t, status: 'done' as const } : t
    );
    const ready = new Set(readyTasks(tasks).map((t) => t.id));
    tasks = tasks.map((t) => (ready.has(t.id) ? { ...t, status: 'running' as const } : t));

    const completed = tasks.every((t) => t.status === 'done');
    const next: IntentRun = { ...run, tasks, phases: derivePhases(tasks), completed };

    useEngineStore.getState().onTasksChanged(tasks);
    if (completed) {
      useEngineStore.getState().onRunCompleted(run.intent);
      set((state) => ({
        currentRun: next,
        history: [next, ...state.history].slice(0, 20),
      }));
    } else {
      set({ currentRun: next });
    }
  },

  reset: () => {
    if (timer) clearTimeout(timer);
    useEngineStore.getState().onTasksChanged([]);
    set({ currentRun: null });
  },
}));
