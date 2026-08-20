'use client';

import { EXECUTION_PHASES, PHASE_DESCRIPTIONS } from '../../lib/phases';
import { useIntentStore } from '../../store/intentStore';

export function LivingExecutionTimeline() {
  const run = useIntentStore((s) => s.currentRun);
  const reset = useIntentStore((s) => s.reset);

  if (!run) return null;

  return (
    <div className="w-full max-w-xl animate-[fadeIn_0.4s_ease]">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          <span className="text-neutral-600">Intent</span> · {run.intent}
        </p>
        <button
          onClick={reset}
          className="text-xs text-neutral-600 transition hover:text-neutral-300"
        >
          {run.completed ? 'Clear' : 'Cancel'}
        </button>
      </div>
      <ol className="relative ml-3 border-l border-neutral-800">
        {EXECUTION_PHASES.map((phase) => {
          const status = run.phases[phase];
          return (
            <li key={phase} className="relative mb-8 ml-6 last:mb-0">
              <span
                className={`absolute -left-[31px] top-1 flex h-2.5 w-2.5 items-center justify-center rounded-full transition-colors duration-500 ${
                  status === 'done'
                    ? 'bg-neutral-200'
                    : status === 'active'
                      ? 'bg-emerald-400'
                      : 'bg-neutral-800'
                }`}
              >
                {status === 'active' && (
                  <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-emerald-400 opacity-40" />
                )}
              </span>
              <p
                className={`text-sm font-medium transition-colors duration-500 ${
                  status === 'pending' ? 'text-neutral-700' : 'text-neutral-200'
                }`}
              >
                {phase}
              </p>
              <p
                className={`text-xs transition-colors duration-500 ${
                  status === 'active' ? 'text-neutral-500' : 'text-neutral-800'
                }`}
              >
                {PHASE_DESCRIPTIONS[phase]}
              </p>
              {status === 'active' &&
                run.tasks
                  .filter((t) => t.phase === phase && t.status === 'running')
                  .map((t) => (
                    <p key={t.id} className="mt-1 text-xs text-sky-400/70">
                      {t.agent} · {t.title}
                    </p>
                  ))}
            </li>
          );
        })}
      </ol>
      {run.completed && (
        <p className="mt-4 text-center text-xs text-emerald-500/80">
          Intent fulfilled — outcome written to architecture memory
        </p>
      )}
    </div>
  );
}
