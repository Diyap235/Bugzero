import assert from "node:assert/strict";
import test from "node:test";
import { invitationFragment, postAuthenticationDestination } from "../src/lib/auth/invitation-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

test("invitation navigation preserves only a valid token and organization in the URL fragment", () => {
  const hash = `#organizationId=${organizationId}&token=${token}&unexpected=discard`;
  const safeFragment = `#organizationId=${organizationId}&token=${token}`;

  assert.equal(invitationFragment(hash), safeFragment);
  assert.equal(postAuthenticationDestination("/dashboard", hash), `/invitations/accept${safeFragment}`);
});

test("invalid invitation fragments do not become post-authentication redirects", () => {
  assert.equal(invitationFragment("#organizationId=not-a-uuid&token=bad"), null);
  assert.equal(postAuthenticationDestination("/dashboard", "#token=secret"), "/dashboard");
});
