"use client";

import { Database, Globe, Brain, Server } from "lucide-react";
import { Handle, Position } from "@xyflow/react";
import { motion } from "framer-motion";

export default function ArchitectureNode({ data }: { data: { title: string } }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-80 rounded-2xl border border-cyan-400/20 bg-black/50 backdrop-blur-xl shadow-[0_0_40px_rgba(34,211,238,0.15)] p-5"
    >
      <Handle type="target" position={Position.Top} />
      <div className="text-cyan-300 font-semibold mb-5">{data.title}</div>
      <div className="space-y-3">
        <NodeItem icon={<Globe size={16} />} name="Frontend Layer" />
        <NodeItem icon={<Server size={16} />} name="API Gateway" />
        <NodeItem icon={<Database size={16} />} name="Database Core" />
        <NodeItem icon={<Brain size={16} />} name="AI Gateway" />
      </div>
      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  );
}

function NodeItem({ icon, name }: { icon: React.ReactNode; name: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-300">
      <span className="text-cyan-400">{icon}</span>
      {name}
    </div>
  );
}
