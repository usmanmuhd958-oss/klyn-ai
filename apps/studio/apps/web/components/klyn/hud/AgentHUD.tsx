"use client";

import { Activity, Cpu, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

const agents = [
  { name: "Coder", task: "Generating components", status: "executing" },
  { name: "Architect", task: "Planning system graph", status: "thinking" },
  { name: "Reviewer", task: "Running verification", status: "done" },
];

export default function AgentHUD() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-80 rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl shadow-2xl p-4"
    >
      <div className="flex items-center gap-2 mb-4 text-sm text-white">
        <Activity size={16} className="text-emerald-400" />
        Agent Swarm
      </div>

      <div className="space-y-3">
        {agents.map((agent) => (
          <div key={agent.name} className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="flex justify-between text-sm">
              <span>{agent.name}</span>
              <span
                className={`text-xs ${
                  agent.status === "done"
                    ? "text-emerald-400"
                    : agent.status === "thinking"
                    ? "text-violet-400"
                    : "text-cyan-400"
                }`}
              >
                {agent.status}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">{agent.task}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs text-zinc-400">
        <Cpu size={13} />
        Runtime: Active
        <ShieldCheck size={13} className="ml-auto text-emerald-400" />
      </div>
    </motion.div>
  );
}
