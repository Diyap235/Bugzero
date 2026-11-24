# API authentication

The executable API defaults to the EdDSA JWT verifier in `src/auth/signed-token.ts`. It uses `jose` to verify the signature with the Ed25519 `AUTH_PUBLIC_KEY`, and enforces the configured issuer (`bugzero-auth` by default), audience (`bugzero-api` by default), expiration, and the BugZero identity claims.

The accepted identity claims are `sub` (user UUID) and `org` (organization UUID), with `iss`, `aud`, `iat`, and `exp`. The API resolves organization membership and role from its own data; tokens do not grant roles or replace membership checks.

`POST /auth/signup` creates a user, a workspace, and an OWNER membership in one database transaction. Passwords are persisted as scrypt hashes. `/auth/register` remains a compatible alias. `POST /auth/login` verifies the persisted account and its default workspace membership. Both routes issue signed Ed25519 JWTs consumed by the existing verifier. `GET /auth/session` validates current organization membership and returns persisted workspace details for browser session restoration.

Organization managers can create invitations with `POST /organizations/invitations` and list statuses with `GET /organizations/invitations`. The API authorizes the caller's current OWNER/ADMIN membership and only accepts DEVELOPER, SECURITY_REVIEWER, or VIEWER roles. Invitation tokens are random, stored only as SHA-256 digests, expire after seven days, and are accepted once by an authenticated account whose normalized email matches the invitation. Acceptance locks and consumes the invitation and creates membership in one transaction; the new signed session and default workspace switch to the invited organization. Invitations are tenant-scoped with forced RLS.

No email delivery provider is configured. The settings page displays the one-time acceptance link to the authorized inviter, who must send it only to the bound email address using an approved channel. The token is placed in the URL fragment so it is not sent in HTTP requests or server access logs, and is removed from browser history after an authenticated recipient opens the acceptance page. Invitation list responses never include tokens.

For local development, run `pnpm --filter @bugzero/api dev-auth:setup` to generate a keypair, store its private key outside the repository at `~/.bugzero/dev-auth/ed25519-private.pem`, and populate the root `.env.local` with its public key. Production must provide the corresponding `AUTH_PRIVATE_KEY` using a secret manager.

Production must provide the matching Ed25519 private key through a secret manager. The API continues to verify signatures, issuer, audience, expiry, and UUID identities, and it checks current database membership for every tenant-scoped request.
