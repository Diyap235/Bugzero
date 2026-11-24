# BugZero config workspace

This package holds shared runtime configuration for the monorepo. PostgreSQL connectivity is provided by the database package from `DATABASE_URL`; there is no separate queue or graph service configuration.

The built-in analysis profile definition also lives here so API routes resolve a named persisted profile rather than hard-coding analyzer configuration. The authoritative engineering guidance remains in the root documentation and the ADRs.

The worker reads `NVIDIA_API_KEY` and optional `NVIDIA_MODEL` from its server-side process environment. The default model is `openai/gpt-oss-20b`; verify model availability with NVIDIA before configuring a different ID. Credentials must never be exposed to browser-side `NEXT_PUBLIC_*` variables.
