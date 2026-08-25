"use client";

import { Handle, Position } from "@xyflow/react";
import { Bot, Terminal, CheckCircle2, Loader2, BrainCircuit } from "lucide-react";
import { motion } from "framer-motion";

type AgentStatus = "idle" | "thinking" | "executing" | "done";

interface AgentNodeProps {
  data: {
    name: string;
    status: AgentStatus;
  };
}

const statusConfig = {
  idle: { label: "Idle", color: "text-zinc-400" },
  thinking: { label: "Thinking", color: "text-violet-400" },
  executing: { label: "Executing", color: "text-cyan-400" },
  done: { label: "Done", color: "text-emerald-400" },
};

export default function AgentNode({ data }: AgentNodeProps) {
  const status = statusConfig[data.status] || statusConfig.idle;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-96 rounded-2xl border border-violet-500/30 bg-black/60 backdrop-blur-xl shadow-[0_0_50px_rgba(139,92,246,.25)] overflow-hidden"
    >
      <Handle type="target" position={Position.Top} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-violet-300">
          <Bot size={18} />
          <span className="font-medium">{data.name}</span>
        </div>

        <div className={`flex items-center gap-2 text-xs ${status.color}`}>
          {data.status === "thinking" && <Loader2 size={13} className="animate-spin" />}
          {data.status === "executing" && <Terminal size={13} />}
          {data.status === "done" && <CheckCircle2 size={13} />}
          {status.label}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <BrainCircuit size={14} />
          Current Mission
        </div>

        <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-xs space-y-2 font-mono">
          <div className="text-violet-300">✓ Analyze project intent</div>
          <div className="text-cyan-300">✓ Generate architecture graph</div>
          <div className="text-zinc-500">→ Waiting for verification</div>
        </div>

        <div className="rounded-xl bg-black/40 border border-white/10 p-3 text-xs font-mono space-y-1">
          <p className="text-emerald-400">$ agent.execute()</p>
          <p className="text-zinc-400">Generating optimized API layer...</p>
          <p className="text-zinc-500">EventBus: stream.connected</p>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  );
}
