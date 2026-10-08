"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) router.replace("/dashboard");
  }, [auth.isAuthenticated, auth.isLoading, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.login({ email, password });
      setPassword("");
      router.replace("/dashboard");
    } catch (reason) {
      setPassword("");
      setError(reason instanceof ApiError && reason.code === "UNAUTHORIZED"
        ? "The email or password is not valid."
        : reason instanceof ApiError && reason.code === "FORBIDDEN"
          ? "This account does not have access to a BugZero organization."
          : reason instanceof ApiError && reason.code === "NOT_FOUND"
            ? "Sign-in is not available in this environment."
            : "Sign-in could not be completed. Check your credentials or try again later.");
    } finally {
      setSubmitting(false);
    }
  };

  if (auth.isLoading || auth.isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-text-muted" role="status">
        {auth.isLoading ? "Checking your session…" : "Opening your workspace…"}
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(46,125,50,0.14),transparent_55%)]" />
      <section className="relative w-full max-w-md rounded-2xl border border-border bg-card/95 p-7 shadow-2xl sm:p-9">
        <Link href="/" className="inline-flex items-center gap-3" aria-label="BugZero home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-lg font-bold tracking-wide text-white">BUG<span className="text-primary">ZERO</span></span>
            <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Code Intelligence</span>
          </span>
        </Link>

        <div className="mt-9 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Workspace sign-in
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Welcome back</h1>
        <p className="mt-2 text-sm leading-6 text-text-muted">Sign in to explore your BugZero repository intelligence workspace.</p>

        {auth.sessionExpired && (
          <p className="mt-5 rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-200" role="status">
            Your session expired. Sign in again to continue.
          </p>
        )}
        {error && (
          <p className="mt-5 rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-200" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <label className="block text-xs font-medium text-text-secondary" htmlFor="email">
            Email
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-xs font-medium text-text-secondary" htmlFor="password">
            Password
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="Enter your password"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? "Signing in…" : "Continue"}
            {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-muted">
          New to BugZero? <Link href="/signup" className="font-medium text-primary hover:underline">Create an account</Link>
        </p>
        <Link href="/" className="mt-6 block text-center text-xs text-text-muted transition-colors hover:text-white">
          Back to BugZero
        </Link>
      </section>
    </main>
  );
}
