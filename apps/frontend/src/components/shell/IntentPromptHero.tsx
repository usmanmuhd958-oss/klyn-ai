export function IntentPromptHero() {
  return (
    <div className="flex flex-col items-center gap-6 text-center select-none">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-neutral-100 to-neutral-400 shadow-[0_0_60px_-12px_rgba(255,255,255,0.4)]">
        <span className="text-2xl font-semibold tracking-tight text-neutral-900">K</span>
      </div>
      <h1 className="text-4xl font-medium tracking-tight text-neutral-100 sm:text-5xl">
        What do you want to build?
      </h1>
      <p className="max-w-md text-sm text-neutral-500">
        Describe an outcome. KLYN architects, builds, tests and ships it autonomously.
      </p>
    </div>
  );
}
