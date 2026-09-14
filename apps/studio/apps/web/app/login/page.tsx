"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      router.replace(next);
      router.refresh();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
    } else if (data.session) {
      router.replace(next);
      router.refresh();
      return;
    } else {
      setMessage("Check your email to confirm your account, then sign in.");
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen grid place-items-center bg-[#09090b] px-6 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-xl">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-white/40">KLYN</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-white/50">
            {mode === "signin"
              ? "Sign in to enter your engineering workspace."
              : "Create an account to access your KLYN workspace."}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-white/60">Email</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-white/30"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-medium text-white/60">Password</span>
            <input
              required
              minLength={6}
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-white/30"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}

          {message && (
            <p role="status" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
              {message}
            </p>
          )}

          <button
            disabled={loading}
            type="submit"
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
          }}
          className="mt-6 w-full text-center text-sm text-white/50 hover:text-white/80"
        >
          {mode === "signin"
            ? "Need an account? Create one"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
