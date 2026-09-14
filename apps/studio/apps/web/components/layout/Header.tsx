"use client";

import { Activity, Brain, Shield } from "lucide-react";
import SignOutButton from "../auth/SignOutButton";

export default function Header() {
  return (
    <header className="glass h-16 flex items-center justify-between px-6">
      <div className="text-xl font-bold text-cyan-300">◈ KLYN STUDIO</div>

      <div className="flex gap-5 text-sm">
        <span className="flex items-center gap-1"><Brain /> Architect Online</span>
        <span className="flex items-center gap-1"><Activity /> Builder Active</span>
        <span className="flex items-center gap-1"><Shield /> Guard Ready</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-full border border-cyan-500/30 px-4 py-2">
          Intent Verified
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
