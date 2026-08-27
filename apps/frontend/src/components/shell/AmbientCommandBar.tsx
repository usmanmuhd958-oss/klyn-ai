'use client';

import { useState, type FormEvent } from 'react';
import { useIntentStore } from '../../store/intentStore';
import { useEngineStore } from '../../store/engineStore';
import { getSharedIntentLog } from '../../lib/collab';

const SUGGESTIONS = [
  'Make this application faster',
  'Harden the API against failure',
  'Ship a realtime collaboration layer',
];

const DEEP_MODE_COMMAND = 'open engineering view';

export function AmbientCommandBar() {
  const [value, setValue] = useState('');
  const submitIntent = useIntentStore((s) => s.submitIntent);
  const setDeepMode = useEngineStore((s) => s.setDeepMode);

  const submit = (intent: string) => {
    const trimmed = intent.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === DEEP_MODE_COMMAND) {
      setDeepMode(true);
      setValue('');
      return;
    }
    getSharedIntentLog().push([trimmed]);
    submitIntent(trimmed);
    setValue('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(value);
  };

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4">
      <form onSubmit={onSubmit} className="w-full">
        <div className="group relative w-full rounded-2xl border border-neutral-800 bg-neutral-900/80 shadow-2xl backdrop-blur transition focus-within:border-neutral-600">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Express an intent…"
            aria-label="Intent input"
            className="w-full bg-transparent px-5 py-4 text-base text-neutral-100 placeholder-neutral-600 outline-none"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 opacity-0 transition group-focus-within:opacity-100 hover:bg-white"
          >
            Engage
          </button>
        </div>
      </form>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => submit(s)}
            className="rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-500 transition hover:border-neutral-600 hover:text-neutral-300"
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-neutral-700">
        ⌘K for Deep Engineering Mode · or type “Open Engineering View”
      </p>
    </div>
  );
}
