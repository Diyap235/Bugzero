import { AcceptOrganizationInvitationRequestSchema } from "@bugzero/contracts";

export function invitationFragment(hash: string): string | null {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const invitation = AcceptOrganizationInvitationRequestSchema.safeParse({
    organizationId: parameters.get("organizationId"),
    token: parameters.get("token"),
  });
  return invitation.success
    ? `#${new URLSearchParams({
      organizationId: invitation.data.organizationId,
      token: invitation.data.token,
    }).toString()}`
    : null;
}

export function postAuthenticationDestination(fallback: string, hash: string): string {
  const fragment = invitationFragment(hash);
  return fragment ? `/invitations/accept${fragment}` : fallback;
}
