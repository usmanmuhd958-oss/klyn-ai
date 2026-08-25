"use client";

import { useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { parseIntent } from "@/lib/runtime/intentParser";
import { klynEventBus } from "@/lib/runtime/eventBus";
import { createMission, executeMission } from "@/lib/runtime/missionPlanner";

export default function CommandPalette() {
  const [prompt, setPrompt] = useState("");

  function executeIntent() {
    if (!prompt.trim()) return;

    const mission = parseIntent(prompt);

    klynEventBus.emit("intent.created", mission.intent);

    mission.nodes.forEach((node) => {
      klynEventBus.emit("node.created", node);
    });

    mission.edges.forEach((edge) => {
      klynEventBus.emit("edge.created", edge);
    });

    const swarmMission = createMission(prompt);
    executeMission(swarmMission);

    setPrompt("");
  }

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: -20,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <Search size={18} className="text-zinc-400" />

        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") executeIntent();
          }}
          placeholder="Describe what you want Klyn to build..."
          className="flex-1 bg-transparent outline-none text-sm text-white"
        />

        <button
          onClick={executeIntent}
          className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 p-2"
        >
          <Sparkles size={16} />
        </button>
      </div>
    </motion.div>
  );
}
