"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  Cpu,
  Code2,
  ShieldCheck,
  Terminal,
  Network,
  UserCog,
  X,
} from "lucide-react";

import {
  useStudioStore,
} from "@/store/useStudioStore";

import type {
  StudioAgent,
  AgentRole,
  AgentStatus,
} from "@/types/studio";

const statusStyles: Record<AgentStatus, string> = {
  idle: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  thinking: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  planning: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  executing: "bg-green-500/20 text-green-400 border-green-500/40",
  reviewing: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  failed: "bg-red-500/20 text-red-400 border-red-500/40",
};

function RoleIcon(role: AgentRole) {
  switch (role) {
    case "architect":
      return <Cpu size={18} />;
    case "backend-engineer":
    case "frontend-engineer":
      return <Code2 size={18} />;
    case "security-agent":
      return <ShieldCheck size={18} />;
    case "devops":
      return <Terminal size={18} />;
    default:
      return <UserCog size={18} />;
  }
}

function AgentCard({
  agent,
  active,
  onClick,
}: {
  agent: StudioAgent;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full flex-col gap-3 rounded-xl border p-4 text-left backdrop-blur-xl transition-all ${
        active
          ? "border-blue-500/60 bg-blue-500/10"
          : "border-[#27272a] bg-[#09090b]/70 hover:bg-[#18181b]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white/5 p-2">
            {RoleIcon(agent.role)}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{agent.name}</p>
            <p className="text-xs text-zinc-500">{agent.role}</p>
          </div>
        </div>

        <span
          className={`rounded-full border px-2 py-1 text-[10px] uppercase ${
            statusStyles[agent.status]
          }`}
        >
          {agent.status}
        </span>
      </div>

      <div className="space-y-1 text-xs text-zinc-400">
        <p>
          Task:
          <span className="text-zinc-200">
            {" "}{agent.currentTask ?? "Waiting"}
          </span>
        </p>
        <p>
          Tokens:
          <span className="text-zinc-200"> {" "}{agent.tokensUsed}</span>
        </p>
        <p>
          Latency:
          <span className="text-zinc-200">
            {" "}{agent.latencyMs ?? 0}ms
          </span>
        </p>
      </div>
    </button>
  );
}

export default function AgentSwarmVisualizer() {
  const { swarm, activeAgentId } = useStudioStore();
  const [selectedAgent, setSelectedAgent] = useState<StudioAgent | null>(null);

  const connections = useMemo(() => swarm.connections, [swarm.connections]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-[#09090b] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={20} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-white">Agent Orchestra</h2>
        </div>
        <span className="text-xs text-zinc-500">
          {swarm.agents.length} Agents
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 overflow-y-auto">
        {swarm.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            active={activeAgentId === agent.id}
            onClick={() => setSelectedAgent(agent)}
          />
        ))}
      </div>

      {connections.length > 0 && (
        <div className="rounded-xl border border-[#27272a] bg-[#111113] p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
            <Network size={14} />
            Collaboration Flow
          </div>

          {connections.map((connection) => (
            <div
              key={connection.sourceAgentId + connection.targetAgentId}
              className="text-xs text-zinc-300"
            >
              {connection.sourceAgentId}
              {" → "}
              {connection.targetAgentId}
              <span className="text-blue-400">
                {" "}
                ({connection.relation})
              </span>
            </div>
          ))}
        </div>
      )}

      {selectedAgent && (
        <div className="fixed right-6 top-20 w-80 rounded-xl border border-[#27272a] bg-[#09090b]/95 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Agent Context</h3>
            <button onClick={() => setSelectedAgent(null)}>
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3 text-xs text-zinc-400">
            <p>
              Name: <span className="text-white">{selectedAgent.name}</span>
            </p>
            <p>
              Status: <span className="text-white">{selectedAgent.status}</span>
            </p>
            <p>
              Current Task:{" "}
              <span className="text-white">
                {selectedAgent.currentTask ?? "None"}
              </span>
            </p>
            <p>
              Connected Agents:{" "}
              <span className="text-white">
                {selectedAgent.connectedAgents.length}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
