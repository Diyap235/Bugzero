"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Bell, SlidersHorizontal, UserRound } from "lucide-react";
import { PageHeading } from "@/components/product/ui";
import { ApiError, bugzeroApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/auth-context";
import { OrganizationInvitationRoleSchema } from "@bugzero/contracts";
import type { OrganizationInvitation, OrganizationInvitationRole } from "@bugzero/contracts";

const settings = [
  { title: "Profile", description: "Personal account details and profile preferences.", icon: UserRound },
  { title: "Notifications", description: "Alerts for completed analyses and important findings.", icon: Bell },
  { title: "Preferences", description: "Workspace appearance and analysis defaults.", icon: SlidersHorizontal },
];

export default function SettingsPage() {
  const auth = useAuth();
  const canManageInvitations = auth.user?.role === "OWNER" || auth.user?.role === "ADMIN";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationInvitationRole>("DEVELOPER");
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshInvitations = useCallback(async () => {
    setLoadingInvitations(true);
    try {
      setInvitations(await bugzeroApi.listOrganizationInvitations());
    } catch (reason) {
      setError(reason instanceof ApiError
        ? reason.message
        : "Organization invitations could not be loaded.");
    } finally {
      setLoadingInvitations(false);
    }
  }, []);

  useEffect(() => {
    if (!auth.isLoading && canManageInvitations) void refreshInvitations();
  }, [auth.isLoading, canManageInvitations, refreshInvitations]);

  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setInvitationLink(null);
    setCopied(false);
    setSubmitting(true);
    try {
      const created = await bugzeroApi.createOrganizationInvitation({ email, role });
      const url = new URL("/invitations/accept", window.location.origin);
      url.hash = new URLSearchParams({
        organizationId: created.invitation.organizationId,
        token: created.token,
      }).toString();
      setInvitationLink(url.toString());
      setNotice(`Invitation created for ${created.invitation.email}. Send this one-time link only to that address; it expires in seven days.`);
      setEmail("");
      await refreshInvitations();
    } catch (reason) {
      setError(reason instanceof ApiError
        ? reason.message
        : "The invitation could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyInvitationLink = async () => {
    if (!invitationLink) return;
    try {
      await navigator.clipboard.writeText(invitationLink);
      setCopied(true);
      setError(null);
    } catch {
      setError("The invitation link could not be copied. Select and copy the link manually.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeading eyebrow="Workspace" title="Settings" description="Manage your BugZero workspace preferences." />
      <div className="grid gap-3 lg:grid-cols-3">
        {settings.map(({ title, description, icon: Icon }) => (
          <section key={title} className="rounded-xl border border-border bg-card p-5">
            <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="mt-4 text-sm font-semibold text-white">{title}</h2>
            <p className="mt-2 text-xs leading-5 text-text-muted">{description}</p>
            <p className="mt-4 border-t border-border pt-3 text-[10px] text-text-muted">Not available in this workspace yet.</p>
          </section>
        ))}
      </div>

      {canManageInvitations && (
        <section className="rounded-xl border border-border bg-card p-5 sm:p-7">
          <h2 className="text-lg font-semibold text-white">Organization invitations</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            Invite an existing account or someone who will register with the invited email address. Only Developer, Security Reviewer, and Viewer roles can be assigned.
          </p>
          {error && <p className="mt-4 text-sm text-rose-200" role="alert">{error}</p>}
          {notice && <p className="mt-4 text-sm text-emerald-200" role="status">{notice}</p>}
          {invitationLink && (
            <div className="mt-4 space-y-3 rounded-lg border border-border bg-background p-4">
              <label className="block text-xs font-medium text-text-secondary" htmlFor="invitation-link">One-time invitation link</label>
              <input id="invitation-link" readOnly value={invitationLink} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white" />
              <button type="button" onClick={() => void copyInvitationLink()} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-white hover:bg-card">
                {copied ? "Copied" : "Copy invitation link"}
              </button>
            </div>
          )}

          <form onSubmit={(event) => void createInvitation(event)} className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
            <label className="block text-xs font-medium text-text-secondary" htmlFor="invitation-email">
              Invitee email
              <input
                id="invitation-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="block text-xs font-medium text-text-secondary" htmlFor="invitation-role">
              Role
              <select id="invitation-role" value={role} onChange={(event) => {
                const parsedRole = OrganizationInvitationRoleSchema.safeParse(event.target.value);
                if (parsedRole.success) setRole(parsedRole.data);
              }} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary">
                <option value="DEVELOPER">Developer</option>
                <option value="SECURITY_REVIEWER">Security Reviewer</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </label>
            <button type="submit" disabled={submitting} className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70">
              {submitting ? "Creating…" : "Create invitation"}
            </button>
          </form>

          <div className="mt-8">
            <h3 className="text-sm font-semibold text-white">Recent invitations</h3>
            {loadingInvitations ? (
              <p className="mt-3 text-xs text-text-muted" role="status">Loading invitations…</p>
            ) : invitations.length === 0 ? (
              <p className="mt-3 text-xs text-text-muted">No invitations yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                    <span className="text-white">{invitation.email} · {invitation.role}</span>
                    <span className="text-text-muted">{invitation.status} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
      {!canManageInvitations && !auth.isLoading && (
        <p className="text-xs text-text-muted">Only organization owners and admins can manage invitations.</p>
      )}
      <Link href="/repositories" className="inline-flex text-xs text-primary hover:underline">Explore repositories →</Link>
    </div>
  );
}
