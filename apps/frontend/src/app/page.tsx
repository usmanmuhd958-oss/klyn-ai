'use client';

import { IntentPromptHero } from '../components/shell/IntentPromptHero';
import { AmbientCommandBar } from '../components/shell/AmbientCommandBar';
import { AgentStatusIndicator } from '../components/shell/AgentStatusIndicator';
import { LivingExecutionTimeline } from '../components/shell/LivingExecutionTimeline';
import { DeepModeOverlay } from '../components/deep-mode/DeepModeOverlay';
import { useIntentStore } from '../store/intentStore';
import { useRealtimeIntentBroadcast } from '../lib/realtime';

export default function Home() {
  const run = useIntentStore((s) => s.currentRun);
  useRealtimeIntentBroadcast(run?.intent ?? null);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-12 px-6 py-16">
      <AgentStatusIndicator />
      {!run && <IntentPromptHero />}
      <AmbientCommandBar />
      <LivingExecutionTimeline />
      <DeepModeOverlay />
    </main>
  );
}
