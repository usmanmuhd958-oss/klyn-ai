"use client";

import { useState } from "react";
import { ChevronDown, Building2, Check } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/useWorkspaceStore";

export default function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);

  const { activeWorkspace, members, setWorkspace } = useWorkspaceStore();

  const workspaces = members.map((member) => ({
    id: member.workspaceId,
    name: `Workspace ${member.workspaceId.slice(0, 6)}`,
  }));

  function switchWorkspace(workspace: { id: string; name: string }) {
    setWorkspace({
      id: workspace.id,
      name: workspace.name,
      ownerId: "",
    });

    setOpen(false);
  }

  return (
    <div className="relative w-72">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl px-4 py-3 hover:border-cyan-400/40 transition"
      >
        <div className="flex items-center gap-3">
          <Building2 className="text-cyan-400" />
          <div className="text-left">
            <p className="text-sm font-medium text-white">
              {activeWorkspace?.name ?? "No workspace"}
            </p>
            <span className="text-xs text-white/40">Active workspace</span>
          </div>
        </div>
        <ChevronDown size={16} />
      </button>

      {open && (
        <div className="absolute mt-2 w-full rounded-xl border border-white/10 bg-[#090D16] backdrop-blur-xl shadow-2xl z-50 overflow-hidden">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              onClick={() => switchWorkspace(workspace)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 text-sm text-white"
            >
              <span>{workspace.name}</span>
              {activeWorkspace?.id === workspace.id && (
                <Check size={16} className="text-emerald-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
