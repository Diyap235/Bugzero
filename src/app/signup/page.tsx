"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/auth-context";

export default function SignupPage() {
  const router = useRouter();
  const auth = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) router.replace("/repositories");
  }, [auth.isAuthenticated, auth.isLoading, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const name = displayName.trim();
      await auth.register({
        displayName: name,
        email: email.trim(),
        password,
        workspaceName: `${name}'s workspace`.slice(0, 80),
      });
      setPassword("");
      setConfirmPassword("");
      router.replace("/repositories");
    } catch (reason) {
      setPassword("");
      setConfirmPassword("");
      setError(reason instanceof ApiError && reason.status === 409
        ? "An account with this email already exists. Sign in instead."
        : reason instanceof ApiError && reason.status === 400
          ? "Enter a valid name, email, and password of at least 12 characters."
          : "Your account and workspace could not be created. Please try again.");
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
          Create your BugZero workspace
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Create your account</h1>
        <p className="mt-2 text-sm leading-6 text-text-muted">Give BugZero your codebase and start with a clear, evidence-backed view of its health.</p>

        {error && (
          <p className="mt-5 rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-200" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <label className="block text-xs font-medium text-text-secondary" htmlFor="signup-name">
            Name
            <input id="signup-name" name="name" type="text" autoComplete="name" required minLength={1} maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="block text-xs font-medium text-text-secondary" htmlFor="signup-email">
            Email
            <input id="signup-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="you@example.com" />
          </label>
          <label className="block text-xs font-medium text-text-secondary" htmlFor="signup-password">
            Password
            <input id="signup-password" name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            <span className="mt-1 block text-[11px] text-text-muted">Use at least 12 characters.</span>
          </label>
          <label className="block text-xs font-medium text-text-secondary" htmlFor="signup-confirm-password">
            Confirm password
            <input id="signup-confirm-password" name="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </label>
          <button type="submit" disabled={submitting} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70">
            {submitting ? "Creating account…" : "Create Account"}
            {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-muted">
          Already have an account? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
