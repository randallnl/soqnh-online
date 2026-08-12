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

`requireSiteAdmin()` protects `/admin/invitations`; members without the site-admin role receive a 403 response.

### Member access management

`/admin/members` gives site administrators a searchable view of active, invited, and suspended accounts, their organization memberships, and recent access changes.

- Suspending an active member and revoking all of their unrevoked sessions happen in one transactional D1 batch.
- Restoring a suspended member permits a future magic-link login but does not create a session for them.
- Administrators cannot suspend their own account.
- A conditional database guard prevents suspension when it would leave no active site administrator, including under concurrent requests.
- Invited accounts are managed by reissuing an invitation rather than bypassing the acceptance flow.

## Organization graph

Phase 3 turns the existing organization and affiliation tables into application workflows:

- `/organizations` lists active organization profiles for authenticated members.
- `/organizations/:slug` shows profile details and active organization members with their roles.
- `/admin/organizations` lets site administrators create and update profiles, change lifecycle status, and add, change, or remove organization memberships.
- Only active accounts can receive organization roles.
- Profile and membership mutations use transactional D1 batches and write organization audit actions.
- `/admin/affiliations` lets site administrators manage coalitions, organization links, and direct member links.
- Effective affiliations combine direct assignments with affiliations inherited through organization membership.
- Organization discovery is fail-closed for ordinary members and requires direct membership or a shared effective affiliation.
- `/organizations/:slug/manage` gives organization administrators scoped profile and membership management.

See [affiliations.md](affiliations.md) for the complete visibility and administration policy.

## Invitation and activation flow

1. A site administrator opens `/admin/invitations` and enters an email address, an optional organization, and an organization role.
2. The Worker creates an `invited` user when needed, expires any older pending invitation for the same address, and stores only the SHA-256 hash of a new one-time token.
3. The invitation email is sent through the `EMAIL` binding with both text and HTML bodies. Delivery failure expires the link and creates an audit record.
4. The recipient opens `/invite/accept`, confirms their full name, and submits the same-origin form.
5. A transactional D1 batch consumes the invitation, activates the user, applies the optional organization membership, and writes the acceptance audit event. Each write is conditional on that exact token being consumed in the batch.
6. The Worker creates a secure session and redirects the new member to the dashboard. The invitation cannot be reused.

Invitation links expire after seven days. Reissuing an invitation immediately expires all older pending links for that email address. Active accounts cannot be reinvited, and suspended accounts must be restored through member management rather than invitation.

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
- `invitation.created`
- `invitation.delivery_failed`
- `invitation.accepted`
- `member.suspended`
- `member.restored`
- `organization.created`
- `organization.updated`
- `organization.membership_added`
- `organization.membership_role_changed`
- `organization.membership_removed`
- `organization.profile_updated`
- `affiliation.created`
- `affiliation.updated`
- `affiliation.organization_added`
- `affiliation.organization_removed`
- `affiliation.user_added`
- `affiliation.user_removed`
- `post.created`
- `post.updated`
- `post.archived`

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
