import { create } from 'zustand';
import { EXECUTION_PHASES, type ExecutionPhase, type PhaseStatus } from '../lib/phases';
import { useEngineStore } from './engineStore';

export interface IntentRun {
  id: string;
  intent: string;
  startedAt: number;
  phases: Record<ExecutionPhase, PhaseStatus>;
  completed: boolean;
}

interface IntentState {
  currentRun: IntentRun | null;
  history: IntentRun[];
  submitIntent: (intent: string) => void;
  advancePhase: () => void;
  reset: () => void;
}

const PHASE_DURATION_MS = 1800;

const initialPhases = (): Record<ExecutionPhase, PhaseStatus> => {
  const phases = {} as Record<ExecutionPhase, PhaseStatus>;
  for (const phase of EXECUTION_PHASES) phases[phase] = 'pending';
  phases[EXECUTION_PHASES[0]] = 'active';
  return phases;
};

let timer: ReturnType<typeof setTimeout> | null = null;

export const useIntentStore = create<IntentState>((set, get) => ({
  currentRun: null,
  history: [],

  submitIntent: (intent: string) => {
    if (timer) clearTimeout(timer);

    const run: IntentRun = {
      id: crypto.randomUUID(),
      intent,
      startedAt: Date.now(),
      phases: initialPhases(),
      completed: false,
    };
    set({ currentRun: run });
    useEngineStore.getState().onIntentSubmitted(intent);

    const schedule = () => {
      timer = setTimeout(() => {
        get().advancePhase();
        if (!get().currentRun?.completed) schedule();
      }, PHASE_DURATION_MS);
    };
    schedule();
  },

  advancePhase: () => {
    const run = get().currentRun;
    if (!run || run.completed) return;

    const activeIndex = EXECUTION_PHASES.findIndex((p) => run.phases[p] === 'active');
    if (activeIndex === -1) return;

    const phases = { ...run.phases };
    const activePhase = EXECUTION_PHASES[activeIndex];
    phases[activePhase] = 'done';
    useEngineStore.getState().onPhaseCompleted(activePhase, run.intent);

    const next = EXECUTION_PHASES[activeIndex + 1];
    if (next) {
      phases[next] = 'active';
      set({ currentRun: { ...run, phases } });
    } else {
      const completed = { ...run, phases, completed: true };
      set((state) => ({
        currentRun: completed,
        history: [completed, ...state.history].slice(0, 20),
      }));
    }
  },

  reset: () => {
    if (timer) clearTimeout(timer);
    set({ currentRun: null });
  },
}));
