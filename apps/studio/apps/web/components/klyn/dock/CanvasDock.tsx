"use client";

import { Plus, Bot, Code2, Scan, Maximize2 } from "lucide-react";
import { motion } from "framer-motion";

const tools = [
  { name: "Code", icon: <Code2 size={18} /> },
  { name: "Agent", icon: <Bot size={18} /> },
  { name: "Minimap", icon: <Scan size={18} /> },
  { name: "Fit", icon: <Maximize2 size={18} /> },
];

export default function CanvasDock() {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl p-3 shadow-2xl"
    >
      {tools.map((tool) => (
        <button
          key={tool.name}
          className="group flex items-center justify-center h-11 w-11 rounded-xl border border-white/10 bg-white/5 text-zinc-300 hover:text-white hover:border-indigo-500/40 hover:bg-indigo-500/10 transition"
          title={tool.name}
        >
          {tool.icon}
        </button>
      ))}

      <button className="h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
        <Plus size={20} />
      </button>
    </motion.div>
  );
}
