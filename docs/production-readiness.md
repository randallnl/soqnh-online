# Production readiness and cutover

This runbook controls the final move from the preview Worker to `nhsolidarityecosystem.com`. The custom domain must not be attached until every preflight item is green.

## Current production evidence

Captured August 24, 2026:

- Candidate Worker: `soqnh-online`
- Candidate URL: `https://soqnh-online.randall-d53.workers.dev`
- Health check: HTTP 200 with D1 `ready` and R2, Email Sending, and scraper bindings `configured`
- Candidate code before Phase 9: Git commit `d4f202e`
- Most recent deployments before Phase 9: versions `01ab5a1a-be43-4c73-8c11-b74ee0181ea0` and `be14f2c1-cb0a-4c55-bdb0-cced413f4e04`
- Phase 9 dry-run bundle: 1,288.70 KiB raw / 238.33 KiB gzip
- Local Worker startup profile: 18.0 ms window, 1.4 ms active CPU (local measurement, not an edge latency guarantee)
- Shared D1: `nh-solidarity-ecosystem` (`3ddedc39-ef24-45ef-a004-c1080fb73301`)
- Shared R2: `nh-ecosystem-assets`
- Target custom domain: `nhsolidarityecosystem.com`

The target hostname did not resolve in DNS during the August 24 check. Treat domain attachment as a new activation unless the Cloudflare zone shows otherwise.

The remote D1 migration-list preflight also returned Cloudflare API error `7403` even though Wrangler was authenticated and the deployed Worker could query D1. Resolve that account/resource authorization mismatch before cutover; a successful health check is not a substitute for administrative database access.

`npm audit` reports four moderate development-only findings through `drizzle-kit` and its legacy `@esbuild-kit/esm-loader` dependency. The advisory concerns exposure of an esbuild development server, not the deployed Worker bundle. npm's proposed automatic remediation is a breaking downgrade of `drizzle-kit`, so it is intentionally not applied; do not expose local development servers to untrusted networks and reassess when Drizzle removes that dependency.

## Readiness gates

- [ ] `nhsolidarityecosystem.com` is an active zone in the same Cloudflare account as `soqnh-online`.
- [ ] The intended apex hostname has no conflicting CNAME or existing Worker Custom Domain.
- [ ] Wrangler can read the bound production D1 database and `npm run db:migrations:list:remote` succeeds.
- [ ] No unreviewed D1 migration is pending.
- [ ] A current D1 Time Travel bookmark or export has been recorded.
- [ ] `npm test` and `npm run check` pass from the exact commit being deployed.
- [ ] `/health` returns 200 from the candidate Worker.
- [ ] An invited member can request a magic link, authenticate, sign out, and authenticate again.
- [ ] A site admin, organization admin, contributor, and viewer have each completed the permission smoke test below.
- [ ] D1, R2, Email Sending, and the scraper have been exercised with production-safe test records.
- [ ] The pre-cutover Worker deployment/version ID and Git commit are recorded below.

## Permission smoke test

Use test accounts with deliberately different affiliations. Do not infer permission correctness from a site-admin session.

1. Confirm a viewer sees only directly shared, ecosystem-wide, or shared-affiliation content.
2. Confirm organization-only content is absent for a member outside that organization.
3. Confirm contributors can create and edit their own organization posts but cannot manage memberships.
4. Confirm organization admins can manage their organization and moderate only its events.
5. Confirm pending events are absent from member feeds until approved.
6. Confirm hidden profiles do not appear to ordinary members.
7. Confirm a site admin can use every operations page and audit-log filter.
8. Confirm comments, mentions, reactions, notifications, uploads, and private media reads honor the same visibility boundary as their parent record.

## Cutover procedure

1. Record the final Git commit and the active `soqnh-online` deployment version.
2. Capture the D1 recovery point and confirm R2 object access. Code deployment does not migrate or copy either resource because the candidate already uses the production bindings.
3. Change `APP_ORIGIN` in `wrangler.jsonc` to `https://nhsolidarityecosystem.com`.
4. Add the exact hostname as a Wrangler custom domain route:

   ```jsonc
   "routes": [
     {
       "pattern": "nhsolidarityecosystem.com",
       "custom_domain": true
     }
   ]
   ```

5. Run `npm run cf-typegen`, `npm test`, and `npm run check` after the config change.
6. Deploy `soqnh-online`. Cloudflare will create the proxied DNS record and certificate for the Custom Domain.
7. Confirm the apex URL, `/health`, login email links, authenticated navigation, uploads, and scraper callback behavior.
8. If `www.nhsolidarityecosystem.com` should work, configure an explicit proxied DNS record plus a redirect rule; Worker Custom Domains match exact hostnames and do not provide wildcard behavior.
9. Watch Workers logs and D1 errors during the first production session. Leave the `workers.dev` hostname enabled as a diagnostic path.

Do not derive authentication links from the incoming host. `APP_ORIGIN` remains the canonical source for email links.

## Rollback

Record these values immediately before cutover:

- Git commit: `________________`
- New deployment/version: `________________`
- Previous known-good deployment/version: `________________`
- D1 recovery bookmark/export: `________________`
- Cutover time in UTC: `________________`

For a code regression, run `wrangler rollback <PREVIOUS_VERSION_ID>` or select the prior deployment in the Cloudflare dashboard. A Worker rollback becomes active across its routes and custom domains.

For a routing or certificate problem, detach the Custom Domain from `soqnh-online` and restore the previously documented DNS/Worker assignment. Do not delete generated certificates during an incident; certificate cleanup can wait until service is stable.

A Worker rollback does not reverse D1 writes, R2 object changes, email delivery, or scraper side effects. Restore D1 with Time Travel only after confirming the exact recovery point and the writes that would be lost. Treat any data restore or object deletion as a separate destructive operation requiring explicit approval.

## Post-cutover acceptance

- [ ] Apex domain resolves over IPv4/IPv6 as expected and presents a valid certificate.
- [ ] Unauthenticated `/` redirects to `/login` on the custom domain.
- [ ] `/health` returns 200 with every binding ready/configured.
- [ ] Magic links use `https://nhsolidarityecosystem.com/auth/verify`.
- [ ] Desktop and 390 px mobile layouts have no horizontal overflow.
- [ ] No new Worker errors, D1 overload errors, or failed scraper runs appear during the observation window.
- [ ] The rollback record above is complete.
