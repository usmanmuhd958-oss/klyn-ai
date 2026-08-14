"use client";

import { useEffect, type ReactNode } from "react";
import type { SwarmEvent } from "@klyn/agent-runtime";
import { bus } from "@/lib/eventBus";
import { getSupabase } from "@/lib/supabaseClient";
import { attachSpaceDoc } from "@/lib/yjsSync";
import { useSpatialStore } from "@/store/useSpatialStore";

export default function RealtimeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // 1. Local bus → spatial store (simulation + remote share one path)
    const offBus = bus.on("swarm:event", (e) => {
      useSpatialStore.getState().ingestSwarmEvent(e);
    });

    // 2. Supabase Realtime → local bus (degrades silently offline)
    const supabase = getSupabase();
    const channel = supabase
      ?.channel("klyn-swarm")
          .on("broadcast", { event: "swarm:event" }, ({ payload }) =>
            bus.emit("swarm:event", payload as SwarmEvent))
          .subscribe();

    // 3. CRDT space document (multiplayer merge backbone)
    const yjs = attachSpaceDoc("studio:main");

    return () => {
      offBus();
      channel?.unsubscribe();
      yjs.destroy();
    };
  }, []);

  return <>{children}</>;
}
