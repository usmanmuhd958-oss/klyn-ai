'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useEngineStore } from '../../store/engineStore';

const EngineeringCanvas = dynamic(
  () => import('./EngineeringCanvas').then((m) => m.EngineeringCanvas),
  { ssr: false }
);

export function DeepModeOverlay() {
  const open = useEngineStore((s) => s.deepModeOpen);
  const setDeepMode = useEngineStore((s) => s.setDeepMode);
  const predictiveSignals = useEngineStore((s) => s.predictiveSignals);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDeepMode(!useEngineStore.getState().deepModeOpen);
      }
      if (e.key === 'Escape') setDeepMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setDeepMode]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm">
      <div className="m-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div>
            <p className="text-sm font-medium text-neutral-200">Deep Engineering Mode</p>
            <p className="text-xs text-neutral-600">
              Spatial architecture · agent network · runtime state · memory graphs
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-3 md:flex">
              {predictiveSignals.map((sig) => (
                <span
                  key={sig.id}
                  title={`confidence ${(sig.confidence * 100).toFixed(0)}%`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    sig.severity === 'critical'
                      ? 'border-red-500/40 text-red-300'
                      : sig.severity === 'watch'
                        ? 'border-amber-500/40 text-amber-200'
                        : 'border-neutral-700 text-neutral-500'
                  }`}
                >
                  {sig.signal}
                </span>
              ))}
            </div>
            <button
              onClick={() => setDeepMode(false)}
              className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-neutral-200"
            >
              Esc · Close
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <EngineeringCanvas />
        </div>
      </div>
    </div>
  );
}
