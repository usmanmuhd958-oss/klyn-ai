"use client";

import {
  useMemo,
} from "react";

import {
  Wifi,
  WifiOff,
  Bot,
  Cpu,
  Activity,
} from "lucide-react";

import {
  useStudioStore,
} from "@/store/useStudioStore";

import MonacoWorkspace
from "@/components/workspace/MonacoWorkspace";

import AgentSwarmVisualizer
from "@/components/orchestra/AgentSwarmVisualizer";

import ExecutionTimeline
from "@/components/timeline/ExecutionTimeline";

import CommandPalette
from "@/components/command/CommandPalette";

export default function StudioShell(){

 const {
  currentView,
  connected,
  swarm,
 } = useStudioStore();

 const agentCount = swarm.agents.length;

 const mainContent = useMemo(()=>{
  switch(currentView){
    case "orchestra":
      return (
        <AgentSwarmVisualizer/>
      );

    case "timeline":
      return (
        <ExecutionTimeline/>
      );

    case "editor":
    default:
      return (
        <MonacoWorkspace/>
      );
  }
 },[currentView]);

 return (
 <div
 className="flex h-screen flex-col overflow-hidden bg-[#09090b] text-white"
 >
  {/* Top Header */}
  <header
   className="flex h-12 items-center justify-between border-b border-[#27272a] px-4"
  >
   <div className="flex items-center gap-3">
    <Cpu size={18} className="text-blue-400" />
    <span className="text-sm font-semibold">
     Klyn Studio
    </span>
   </div>

   <div className="flex items-center gap-4 text-xs">
    <div className="flex items-center gap-2">
     {connected ? (
      <Wifi size={14} className="text-green-400" />
     ) : (
      <WifiOff size={14} className="text-red-400" />
     )}
     <span className="text-zinc-400">
      {connected ? "Runtime Online" : "Offline"}
     </span>
    </div>

    <div className="flex items-center gap-2 text-zinc-400">
     <Bot size={14}/>
     {agentCount} Agents
    </div>
   </div>
  </header>

  {/* Workspace */}
  <main className="flex min-h-0 flex-1">
   {/* Left Agent Panel */}
   <aside className="hidden w-72 border-r border-[#27272a] lg:block">
    <AgentSwarmVisualizer/>
   </aside>

   {/* Center */}
   <section className="flex-1 min-w-0">
    {mainContent}
   </section>

   {/* Right Timeline */}
   <aside className="hidden w-80 border-l border-[#27272a] xl:block">
    <ExecutionTimeline/>
   </aside>
  </main>

  {/* Bottom Status */}
  <footer className="flex h-8 items-center justify-between border-t border-[#27272a] px-4 text-xs text-zinc-500">
   <div className="flex items-center gap-2">
    <Activity size={13} />
    Runtime Monitor
   </div>

   <div>
    Model:
    <span className="text-zinc-300"> Klyn-AI</span>
   </div>

   <div>
    Latency:
    <span className="text-zinc-300"> --</span>
   </div>
  </footer>

  {/* Global Command Router */}
  <CommandPalette/>
 </div>
 );
}
