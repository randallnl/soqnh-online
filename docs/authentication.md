# Authentication foundation

Phase 2 starts with an invitation-only, passwordless login flow backed by the existing production identity tables. This slice does not require a D1 migration.

## Request and verification flow

1. A member submits an email address to `/login`. The action enforces same-origin form submission and validates the address.
2. Only an existing `active` user can receive a token. The response is intentionally identical for unknown, invited, suspended, rate-limited, and active addresses.
3. The Worker creates 32 cryptographically random bytes, stores only their SHA-256 hash in `auth_tokens`, and expires the token after 15 minutes.
4. Email delivery runs through `ctx.waitUntil()` using the `EMAIL` binding. A delivery failure consumes the unusable token and writes an audit event.
5. `/auth/verify` atomically consumes the hash with `UPDATE ... RETURNING`. A token cannot be reused.
6. Successful verification creates a new 30-day session. The browser receives the random session secret; D1 stores only its SHA-256 hash.
7. Production cookies use the `__Host-` prefix with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`.
8. Logout revokes the D1 session before clearing the cookie.

## Access enforcement

The dashboard layout and every current dashboard child loader require an authenticated user whose current database status is `active`. Suspending a user therefore blocks an existing session on its next request; deleting a user cascades session deletion.

`requireSiteAdmin()` is available for the invitation and administration routes in the next slice.

## Enumeration and abuse controls

- The login form always returns the same success copy after a syntactically valid email address.
- Email addresses are normalized to lowercase before lookup.
- At most one unconsumed login token is issued per address within two minutes.
- Email delivery is performed after the HTTP response path is ready, reducing observable timing differences and keeping the form responsive.
- Raw tokens, email addresses, and cookie values are never written to application logs.

This application-level throttle is intentionally modest. A Cloudflare rate-limiting rule or Turnstile should be added before broad public promotion of the login URL.

## Audit actions

- `auth.magic_link_requested`
- `auth.magic_link_delivery_failed`
- `auth.login_succeeded`
- `auth.logout`

## Production configuration

- Email Sending domain: `nhsolidarityecosystem.com` (enabled when this slice was implemented)
- Allowed sender: `no-reply@nhsolidarityecosystem.com`
- Canonical email origin: `https://soqnh-online.randall-d53.workers.dev`
- Production database contains active accounts, including an active site administrator, so deployment will not create an administrative lockout.

When the custom domain is connected, update `APP_ORIGIN` in `wrangler.jsonc`, regenerate Worker types, and deploy that configuration before sending new links.

## Verification commands

```bash
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
```
