"use client";

import { useSpatialStore } from "@/store/useSpatialStore";

const ICON: Record<string, string> = {
  running: "◐", passed: "✓", failed: "✕", pending: "○", healing: "↻", skipped: "–",
};

export default function RuntimeMonitor() {
  const workflow = useSpatialStore((s) => s.workflow);
  const nodes = useSpatialStore((s) => s.nodes);
  const runtimes = nodes.filter((n) => n.type === "runtimeNode");

  return (
    <aside className="absolute right-4 top-4 z-10 w-[250px] space-y-2 font-mono">
      <div className="glass-panel rounded-md px-3 py-2">
        <div className="text-[9px] uppercase tracking-[0.25em] text-ink-dim">workflow engine</div>
        {workflow ? (
          <ul className="mt-2 space-y-1 text-[10px]">
            {workflow.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className={s.status === "passed" ? "text-ok" : s.status === "running" ? "text-accent" : "text-ink-dim"}>
                  {ICON[s.status]}
                </span>
                <span className="text-ink">{s.label}</span>
                <span className="ml-auto uppercase text-ink-dim/70">{s.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[10px] text-ink-dim">No active run. Summon ⌘K.</p>
        )}
      </div>
      <div className="glass-panel rounded-md px-3 py-2 text-[9px] uppercase tracking-[0.25em] text-ink-dim">
        runtimes · {runtimes.length} healthy
      </div>
    </aside>
  );
}
