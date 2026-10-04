'use client';

import { useEffect } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key);
  return client;
}

export function useRealtimeIntentBroadcast(intent: string | null): void {
  useEffect(() => {
    if (!intent) return;
    const supabase = getClient();
    if (!supabase) return;

    const channel = supabase.channel('klyn-intents');
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({ type: 'broadcast', event: 'intent', payload: { intent } });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [intent]);
}
