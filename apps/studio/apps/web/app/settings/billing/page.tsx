"use client";

import { useState } from "react";
import UpgradeModal from "@/components/billing/UpgradeModal";

export default function BillingPage() {
  const [showUpgrade, setShowUpgrade] = useState(false);

  const plan = "pro";
  const usage = {
    agents: 7,
    projects: 12,
    tokens: 420000,
  };

  return (
    <div className="min-h-screen bg-[#090D16] p-8 text-white">
      <div className="max-w-5xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold">Billing & Usage</h1>
          <p className="text-white/50">
            Manage Klyn resources and subscription.
          </p>
        </header>

        <section className="grid md:grid-cols-3 gap-5">
          <UsageCard title="AI Agents" value={`${usage.agents}/10`} />
          <UsageCard title="Projects" value={`${usage.projects}/20`} />
          <UsageCard title="Tokens" value={`${usage.tokens.toLocaleString()}`} />
        </section>

        <div className="rounded-2xl border border-cyan-400/20 bg-white/5 p-6 flex justify-between items-center">
          <div>
            <p className="text-sm text-white/50">Current Plan</p>
            <h2 className="text-xl font-semibold capitalize">{plan}</h2>
          </div>

          <button
            onClick={() => setShowUpgrade(true)}
            className="rounded-xl bg-cyan-500 text-black px-5 py-3 font-semibold hover:bg-cyan-400 transition"
          >
            Upgrade
          </button>
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}

function UsageCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <p className="text-white/50 text-sm">{title}</p>
      <p className="text-2xl font-bold mt-2">{value}</p>
    </div>
  );
}
