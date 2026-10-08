# BugZero config workspace

This package holds shared runtime configuration for the monorepo. API and worker queue clients both use the required `REDIS_URL` reader here; missing configuration fails explicitly rather than falling back to localhost.

The built-in analysis profile definition also lives here so API routes resolve a named persisted profile rather than hard-coding analyzer configuration. The authoritative engineering guidance remains in the root documentation and the ADRs.
