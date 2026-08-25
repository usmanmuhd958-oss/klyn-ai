"use client";

import { X, Sparkles } from "lucide-react";

interface Props {
  onClose: () => void;
}

export default function UpgradeModal({ onClose }: Props) {
  async function upgrade() {
    await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "current",
        priceId: "pro_price",
      }),
    });
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#090D16] p-7 relative">
        <button onClick={onClose} className="absolute right-5 top-5 text-white/50">
          <X />
        </button>

        <Sparkles className="text-cyan-400 mb-4" />

        <h2 className="text-2xl font-bold">Unlock Autonomous Engineering</h2>

        <p className="text-white/50 mt-3">
          Increase agent capacity, unlock advanced verification, and access
          priority AI models.
        </p>

        <button
          onClick={upgrade}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-black py-3 font-bold"
        >
          Upgrade Plan
        </button>
      </div>
    </div>
  );
}
