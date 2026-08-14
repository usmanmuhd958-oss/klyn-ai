"use client";

import { useEffect, useRef, useState } from "react";
import { useSpatialStore } from "@/store/useSpatialStore";

export default function TerminalHUD() {
  const logs = useSpatialStore((s) => s.logs);
  const [open, setOpen] = useState(true);
  const tailRef = useRef<HTMLDivElement>(null);

  useEffect(() => { tailRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs.length]);

  return (
    <div className="absolute bottom-6 left-4 z-10 w-[320px] font-mono">
      <button
        onClick={() => setOpen(!open)}
        className="glass-panel w-full rounded-t-md px-3 py-1.5 text-left text-[9px] uppercase tracking-[0.2em] text-ink-dim hover:text-accent"
      >
        {open ? "▾" : "▸"} system telemetry · {logs.length}
      </button>
      {open && (
        <div className="glass-panel max-h-44 overflow-y-auto rounded-b-md border-t-0 px-3 py-2 text-[10px] leading-relaxed">
          {logs.map((l) => (
            <div key={l.id} className={
              l.level === "ok" ? "text-ok" : l.level === "warn" ? "text-warn" : "text-ink-dim"
            }>
              <span className="mr-2 text-accent/60" suppressHydrationWarning>{new Date(l.t).toLocaleTimeString()}</span>
              {" "}{" "}{l.text}
            </div>
          ))}
          <div ref={tailRef} />
        </div>
      )}
    </div>
  );
}
