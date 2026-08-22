# Admin operations

Phase 8 consolidates the existing administration tools into an operating surface for site administrators. It uses the current D1 tables and does not require a migration.

## Routes

- `/admin` — operations overview, attention queues, basic metrics, scraper health, and recent audit activity
- `/admin/audit` — filterable, paginated audit-log viewer
- `/admin/members` — account status and access control
- `/admin/invitations` — member invitations
- `/admin/organizations` — organization lifecycle and membership management
- `/admin/affiliations` — direct and inherited visibility-network management
- `/events/moderation` — pending event decisions
- `/admin/scraper` — partner source configuration, manual runs, and import history

Every route is protected by the site-admin loader guard. Existing mutation routes continue to require same-origin form submissions and write their decisions to `audit_log`.

## Operational summary

The overview reads a bounded set of aggregate values directly through the D1 binding:

- active, invited, and suspended member counts
- active organizations and active organizations without an affiliation
- affiliation count
- published and draft content counts
- pending event moderation count
- active invitation count
- enabled scraper-source count
- latest scraper run status, imported count, and failure message

An attention total combines the queues that require human action: invited accounts, suspended accounts, pending events, active organizations missing affiliations, and a failed latest scraper run. Counts link to the existing workspace where the administrator can resolve them.

## Audit viewer

The viewer orders events newest-first, resolves recognizable labels for users, organizations, affiliations, invitations, posts, events, and comments, and keeps the immutable event identifier visible. Filters are selected from a server-defined allowlist and use bound D1 parameters. Results are limited to 30 events per page.

## Verification

Workers-runtime tests cover operational metrics, pending-work counts, scraper failure status, human-readable audit entities, and audit filtering. The complete Phase 8 gate also includes generated Worker types, TypeScript checks, the production React Router build, and a Wrangler deployment dry run.
