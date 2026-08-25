"use client";

export default function MissionCenter() {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">

      <h2 className="font-semibold">
        MISSION COMMAND
      </h2>

      <input
        className="mt-4 w-full rounded-xl border border-white/10 bg-black p-4 text-white outline-none"
        placeholder="Describe what KLYN should build..."
      />

      <div className="mt-4 text-sm text-gray-400">
        AI agents will analyze, plan and execute.
      </div>

    </section>
  );
}
