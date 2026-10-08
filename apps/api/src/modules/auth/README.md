# API authentication

The executable API defaults to the EdDSA JWT verifier in `src/auth/signed-token.ts`. It uses `jose` to verify the signature with the Ed25519 `AUTH_PUBLIC_KEY`, and enforces the configured issuer (`bugzero-auth` by default), audience (`bugzero-api` by default), expiration, and the BugZero identity claims.

The accepted identity claims are `sub` (user UUID) and `org` (organization UUID), with `iss`, `aud`, `iat`, and `exp`. The API resolves organization membership and role from its own data; tokens do not grant roles or replace membership checks.

For local development only, run `pnpm --filter @bugzero/api dev-auth:setup` to generate a keypair and populate the root `.env.local`. The API receives only the public key. The matching private key stays outside the repository at `~/.bugzero/dev-auth/ed25519-private.pem`. Generate a test JWT with `pnpm --filter @bugzero/api dev-auth:token -- --sub <user-uuid> --org <organization-uuid>`.

This issuer is not an external or production identity provider. Production deployments must configure a trusted authentication adapter and key/issuer/audience independently. Unsigned tokens and the frontend demo token are not accepted.
