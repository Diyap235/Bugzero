"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/auth-context";
import { invitationFragment } from "@/lib/auth/invitation-navigation";

interface InvitationLink {
  organizationId: string;
  token: string;
}

export default function AcceptInvitationPage() {
  const auth = useAuth();
  const router = useRouter();
  const [invitation, setInvitation] = useState<InvitationLink | null>(null);
  const [invitationHash, setInvitationHash] = useState("");
  const [invalidLink, setInvalidLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (auth.isLoading || initialized.current) return;
    initialized.current = true;
    const fragment = invitationFragment(window.location.hash);
    if (!fragment) {
      setInvalidLink(true);
      return;
    }

    const parameters = new URLSearchParams(fragment.slice(1));
    const organizationId = parameters.get("organizationId");
    const token = parameters.get("token");
    if (!organizationId || !token) {
      setInvalidLink(true);
      return;
    }

    setInvitation({ organizationId, token });
    setInvitationHash(fragment);
    if (auth.isAuthenticated) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [auth.isAuthenticated, auth.isLoading]);

  const acceptInvitation = async () => {
    if (!invitation) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.acceptInvitation(invitation);
      router.replace("/repositories");
    } catch (reason) {
      const message = reason instanceof ApiError
        ? reason.message
        : "The invitation could not be accepted. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (auth.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-text-muted" role="status">
        Checking your session…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card/95 p-7 shadow-2xl sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Organization invitation</p>
        <h1 className="mt-4 text-2xl font-semibold text-white">Join a BugZero workspace</h1>

        {invalidLink ? (
          <p className="mt-4 text-sm text-rose-200" role="alert">
            This invitation link is invalid or incomplete. Ask the organization owner to send you a new link.
          </p>
        ) : !invitation ? (
          <p className="mt-4 text-sm text-text-muted" role="status">Loading invitation…</p>
        ) : !auth.isAuthenticated ? (
          <>
            <p className="mt-4 text-sm leading-6 text-text-muted">
              Sign in with the email address this invitation was sent to, or create an account with that email first.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href={`/login${invitationHash}`} className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-semibold text-white">
                Sign in to accept
              </Link>
              <Link href={`/signup${invitationHash}`} className="rounded-lg border border-border px-4 py-3 text-center text-sm font-semibold text-white">
                Create an account
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm leading-6 text-text-muted">
              Signed in as <span className="font-medium text-white">{auth.user?.email}</span>. Accepting switches your active workspace to the invitation’s organization.
            </p>
            {error && (
              <p className="mt-5 rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-200" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => void acceptInvitation()}
              disabled={submitting}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? "Accepting invitation…" : "Accept invitation"}
            </button>
            {error && (
              <button
                type="button"
                onClick={auth.logout}
                className="mt-4 w-full text-center text-xs text-text-muted hover:text-white"
              >
                Sign out to use the invited email account
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
