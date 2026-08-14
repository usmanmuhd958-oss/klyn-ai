"use client";

import { useEffect, useState } from "react";
import { useSpatialStore } from "@/store/useSpatialStore";
import { bus } from "@/lib/eventBus";
import type { SwarmEvent } from "@klyn/agent-runtime";
import type { WorkflowRun } from "@klyn/workflow-engine";

const MODES = ["intent", "refactor", "heal"] as const;

export default function AmbientCommandHUD() {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("intent");
  const hudOpen = useSpatialStore((s) => s.hudOpen);
  const setHud = useSpatialStore((s) => s.setHud);
  const workflow = useSpatialStore((s) => s.workflow);
  const setWorkflow = useSpatialStore((s) => s.setWorkflow);
  const pushLog = useSpatialStore((s) => s.pushLog);
  const queueDiff = useSpatialStore((s) => s.queueDiff);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHud(!useSpatialStore.getState().hudOpen);
      }
      if (e.key === "Escape") setHud(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setHud]);

  /* Demonstrates the autonomy loop end-to-end without a backend. */
  const simulateAutonomy = (original: string) => {
    const thoughts = [
      "Parsing intent into execution graph…",
      "Impact analysis: 2 nodes within blast radius",
      "Drafting token rotation guard…",
    ];
    thoughts.forEach((text, i) =>
      setTimeout(() => bus.emit("swarm:event", {
        type: "agent:thought",
        agentId: "agent-1",
        payload: { step: { id: crypto.randomUUID(), ts: Date.now(), kind: "thought", text } },
      } satisfies SwarmEvent), 600 * (i + 1)));

    setTimeout(() => {
      queueDiff({
        nodeId: "code-1",
        original,
        proposed: original + `\n\nexport function rotateToken(token: string) {\n  return reissue(token, { ttl: 3600 });\n}`,
        source: "agent-1",
        ts: Date.now(),
      });
    }, 2600);
  };

  const submit = () => {
    const intent = value.trim();
    if (!intent) return;
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      intent,
      selfHealCount: 0,
      steps: [
        { id: "s1", label: "Parse intent", kind: "plan", status: "running" },
        { id: "s2", label: "Apply spatial edits", kind: "edit", status: "pending" },
        { id: "s3", label: "Verify graph integrity", kind: "verify", status: "pending" },
      ],
    };
    setWorkflow(run);
    pushLog(`Intent accepted: "${intent}" — workflow ${run.id.slice(0, 8)} dispatched`, "ok");
    setValue("");
    const code1 = useSpatialStore.getState().nodes.find((n) => n.id === "code-1");
    if (code1?.type === "codeNode") simulateAutonomy(code1.data.digest);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-2 font-mono">
      {workflow && (
        <div className="pointer-events-auto glass-panel flex items-center gap-3 rounded-md px-3 py-1.5 text-[9px] uppercase tracking-widest">
          {workflow.steps.map((s) => (
            <span key={s.id} className={
              s.status === "running" ? "text-accent"
              : s.status === "passed" ? "text-ok" : "text-ink-dim"
            }>
              {s.status === "running" ? "◐" : s.status === "passed" ? "✓" : "○"} {s.label}
            </span>
          ))}
        </div>
      )}

      {hudOpen && (
        <div className="pointer-events-auto glass-panel flex w-[640px] max-w-[92vw] items-center gap-2 rounded-lg px-3 py-2.5 shadow-[0_0_40px_rgba(102,252,241,0.08)]">
          <span className="text-accent">⟩</span>
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-widest transition-colors ${
                mode === m ? "border-accent text-accent" : "border-line text-ink-dim hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || (e.metaKey && e.key === "Enter")) submit();
            }}
            placeholder="State your intent. The swarm handles execution…"
            className="flex-1 bg-transparent text-[12px] text-ink placeholder:text-ink-dim focus:outline-none"
          />
          <kbd className="text-[9px] text-ink-dim">⌘↵</kbd>
        </div>
      )}
      {!hudOpen && (
        <button
          onClick={() => setHud(true)}
          className="pointer-events-auto glass-panel rounded-full px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-dim hover:text-accent"
        >
          ⌘K · summon command
        </button>
      )}
    </div>
  );
}
