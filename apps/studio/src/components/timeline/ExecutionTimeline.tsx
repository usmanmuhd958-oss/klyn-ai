"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  Terminal,
  FileCode,
  Bot,
  Zap,
  CheckCircle2,
  XCircle,
  Workflow,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import {
  useStudioStore,
} from "@/store/useStudioStore";

import type {
  ExecutionEvent,
  ExecutionEventType,
} from "@/types/studio";

function EventIcon(type: ExecutionEventType) {
  switch (type) {
    case "terminal.command":
      return <Terminal size={16} />;
    case "file.created":
    case "file.updated":
    case "file.deleted":
      return <FileCode size={16} />;
    case "agent.started":
    case "agent.thinking":
    case "agent.completed":
    case "agent.failed":
      return <Bot size={16} />;
    case "workflow.started":
    case "workflow.completed":
      return <Workflow size={16} />;
    case "system":
      return <Zap size={16} />;
    default:
      return <Zap size={16} />;
  }
}

function StatusIcon(type: ExecutionEventType) {
  if (type.includes("completed")) {
    return <CheckCircle2 size={14} className="text-emerald-400" />;
  }
  if (type.includes("failed")) {
    return <XCircle size={14} className="text-red-400" />;
  }
  return null;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function EventDetails({ event }: { event: ExecutionEvent }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-[#27272a] bg-black/20 p-3 text-xs">
      {event.context && (
        <div>
          <p className="text-zinc-500">AI Context</p>
          <div className="mt-2 space-y-1 text-zinc-300">
            {event.context.model && <p>Model: {event.context.model}</p>}
            {event.context.tokens && <p>Tokens: {event.context.tokens}</p>}
            {event.context.prompt && (
              <p className="rounded bg-[#18181b] p-2 text-zinc-400">
                {event.context.prompt}
              </p>
            )}
          </div>
        </div>
      )}

      {event.diff && (
        <div>
          <p className="text-zinc-500">Code Mutation</p>
          <div className="mt-2 space-y-1 text-zinc-300">
            <p>File: {event.diff.filePath}</p>
            <p>+{event.diff.additions ?? 0} lines</p>
            <p>-{event.diff.deletions ?? 0} lines</p>
          </div>
        </div>
      )}

      <div>
        <p className="text-zinc-500">Metadata</p>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-[#18181b] p-2 text-[11px] text-zinc-400">
          {JSON.stringify(event.metadata ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export default function ExecutionTimeline() {
  const { timeline, clearTimeline } = useStudioStore();
  const [expanded, setExpanded] = useState<string | null>(null);

  const events = useMemo(() => [...timeline].reverse(), [timeline]);

  return (
    <div className="flex h-full flex-col bg-[#09090b]">
      <div className="flex h-12 items-center justify-between border-b border-[#27272a] px-4">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-yellow-400" />
          <span className="text-sm font-semibold text-white">
            Execution Timeline
          </span>
        </div>

        <button
          onClick={clearTimeline}
          className="flex items-center gap-2 rounded-lg border border-[#27272a] px-3 py-1.5 text-xs text-zinc-400 hover:bg-[#18181b]"
        >
          <Trash2 size={14} />
          Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {events.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Waiting for runtime events...
          </div>
        )}

        <div className="space-y-3">
          {events.map((event) => {
            const isOpen = expanded === event.id;

            return (
              <div
                key={event.id}
                className="rounded-xl border border-[#27272a] bg-[#111113]"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : event.id)}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <div className="text-blue-400">{EventIcon(event.type)}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white">{event.message}</p>
                      {StatusIcon(event.type)}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {formatTime(event.timestamp)}
                    </p>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-3 pb-3">
                    <EventDetails event={event} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
