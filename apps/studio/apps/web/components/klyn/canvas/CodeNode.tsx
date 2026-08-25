"use client";

import { Handle, Position } from "@xyflow/react";
import { Code2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export default function CodeNode({
  data,
}: {
  data: { file: string; language: string };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-96 rounded-2xl overflow-hidden border border-indigo-500/30 bg-[#111113]/90 backdrop-blur-xl shadow-[0_0_45px_rgba(99,102,241,.2)]"
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-indigo-300 text-sm">
          <Code2 size={16} />
          {data.file}
        </div>
        <Sparkles size={15} className="text-violet-400" />
      </div>

      <div className="p-4 font-mono text-xs text-zinc-300 space-y-2">
        <div>
          <span className="text-purple-400">const</span> user =
        </div>
        <div className="pl-4">await database.users.find()</div>
        <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-emerald-300">
          AI Diff:
          <br />+ added validation layer
          <br />+ optimized query
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  );
}
