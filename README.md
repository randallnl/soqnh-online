# State of Queer NH

A private collaboration hub for New Hampshire's queer community ecosystem. This is the clean-slate React Router 7 rebuild for Cloudflare Workers.

## What exists now

- React Router 7.18 with server rendering on Cloudflare Workers
- Responsive dashboard, section workspaces, auth layout, and error boundary
- D1, R2, Email Sending, and scraper configuration carried forward
- Drizzle schema aligned to the existing 20-table production database
- Production baseline migration for fresh local databases and future schema changes
- Permission primitives for site and organization roles
- D1-backed dashboard counts with a safe preview fallback
- `/health` resource route that checks D1 and reports binding readiness
- Same-origin protection and Zod validation on the sign-in action
- Hashed, single-use magic links delivered through Cloudflare Email Service
- Hashed D1-backed sessions with secure cookies, logout revocation, and active-account guards
- Authentication audit events and per-address magic-link request throttling
- Affiliation-aware organization discovery with direct and inherited access
- Site-admin affiliation management and organization-admin self-service
- Hidden-profile enforcement in organization member lists
- D1-backed legislation, event, project, and update feeds
- Affiliation-aware and organization-only post visibility
- Scoped post authoring, editing, drafts, archiving, tags, filters, and pagination
- First-class event dates, locations, registration/source links, images, and approval moderation
- Authenticated partner event imports with duplicate protection, run history, and admin source controls
- Workers-runtime authentication tests against a migrated local D1 database
- CI-ready type generation, typecheck, production build, and Wrangler dry run

The production deployment target is the `soqnh-online` Worker. A custom production domain is not configured yet, so the app currently runs at its `workers.dev` URL.

## Local development

Requirements: a current Node.js LTS release and npm.

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Local D1 and R2 state live under `.wrangler/` and are ignored by Git.

Useful commands:

```bash
npm run typecheck          # Regenerate Worker and route types, then run TypeScript
npm test                   # Run authentication tests in the Workers runtime
npm run build              # Production React Router build
npm run check              # Typecheck, build, and Wrangler deploy dry run
npm run db:generate        # Generate a migration after changing app/db/schema.ts
npm run db:migrate:local   # Apply pending migrations to local D1 only
npm run db:migrations:list:remote # Read-only production migration check
npm run deploy             # Deploy the soqnh-online production Worker (requires Cloudflare auth)
```

## Cloudflare bindings

| Binding | Resource | Purpose |
| --- | --- | --- |
| `DB` | `nh-solidarity-ecosystem` | Relational app data in D1 |
| `ASSETS` | `nh-ecosystem-assets` | Logos, profile photos, event images, and uploads in R2 |
| `EMAIL` | `no-reply@nhsolidarityecosystem.com` | Magic links and notifications |
| `SCRAPER_RUN_URL` | Partner event scraper Worker URL | Existing scraper integration point |
| `SCRAPER_API_TOKEN` | Worker secret | Shared bearer token for scraper callbacks |
| `SCRAPER_ADMIN_TOKEN` | Worker secret | Bearer token used to start manual scraper runs |

The health route reports configuration without sending email or listing R2 objects.

`APP_ORIGIN` is the canonical origin placed in authentication emails. Update it when the production custom domain is connected; do not derive sign-in links from an untrusted request host.

### Production data safety

`wrangler.jsonc` includes the existing D1 database ID so the binding is preserved, but `wrangler dev` and `npm run db:migrate:local` use local emulation by default.

The production schema was exported without data on August 11, 2026 and reconciled with `app/db/schema.ts`. `0000_production_baseline.sql` creates that structure for an empty local database and is recorded as an already-applied baseline in production. Future remote migrations remain an explicit, reviewed operation and are never run by the application deployment command.

See [docs/production-database.md](docs/production-database.md) for the baseline evidence and migration checklist.

## Data model

The production schema contains:

- identity: `users`, `sessions`, `auth_tokens`, `invitations`
- community graph: `organizations`, `organization_memberships`, `affiliations`, `organization_affiliations`, `user_affiliations`
- content: `posts`, `post_tags`, `comments`, `post_reactions`, `post_mentions`
- structured content: `events`, `projects`, `attachments`, `video_embeds`
- operations: `notifications`, `audit_log`, `scraper_runs`, `scraper_imports`

IDs are application-generated UUIDs. Timestamps are stored as ISO-compatible text, binary files stay in R2, and D1 stores only their object keys and metadata.

## Architecture boundaries

- Route modules own request/response behavior and progressive enhancement.
- `app/models` owns server-side application queries.
- `app/lib` owns database construction, HTTP security helpers, and reusable permission rules.
- `app/db/schema.ts` is the typed source of truth for the new schema.
- `workers/app.ts` is deliberately small: it passes Cloudflare bindings and execution context into React Router.
- Long-running scraper work will move to a Queue or Workflow rather than run inside a request.

## Current build slice

Phase 4 is complete. The four workspaces now have D1-backed feeds, affiliation and organization visibility, post creation and editing, draft and archive states, tags, filters, pagination, conversations, reactions, mentions, notifications, detail pages, and content audit records. See [docs/content.md](docs/content.md) for the content access model. Phase 3 organization and affiliation controls are documented in [docs/affiliations.md](docs/affiliations.md).

Post detail pages now support comments, one-level threaded replies, support reactions, visibility-safe member mentions, author editing, soft deletion, organization moderation, and interaction audit events. Members have an in-app notification inbox with unread badges and individual or bulk read controls.

Phase 6 is underway. The existing Partner Event Scraper can now load enabled organization sources and submit event batches through authenticated callback routes. Imports use stable identities plus likely-match checks, preserve approved events, enter the Phase 5 moderation queue, and leave a durable decision trail. Site administrators can configure sources, run the scraper manually, and inspect run/import history. See [docs/scraper.md](docs/scraper.md).

Phase 7 adds the people layer: an affiliation-aware member directory, member profile pages, self-service profile editing, private R2-backed profile photos and organization logos, and linked identity across organizations, posts, comments, and mentions. See [docs/profiles.md](docs/profiles.md).

Phase 8 adds the operations layer: a site-admin control center, live D1 metrics, pending-work indicators, scraper health, and a filterable audit-log viewer that links the existing management workspaces into one operating surface. See [docs/admin-operations.md](docs/admin-operations.md).
