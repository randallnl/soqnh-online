# State of Queer NH

A private collaboration hub for New Hampshire's queer community ecosystem. This is the clean-slate React Router 7 rebuild for Cloudflare Workers.

## What exists now

- React Router 7.18 with server rendering on Cloudflare Workers
- Responsive dashboard, section workspaces, auth layout, and error boundary
- D1, R2, Email Sending, and scraper configuration carried forward
- Drizzle schema and generated local-first migration for the 19 core tables
- Permission primitives for site and organization roles
- D1-backed dashboard counts with a safe preview fallback
- `/health` resource route that checks D1 and reports binding readiness
- Same-origin protection and Zod validation on the preview sign-in action
- CI-ready type generation, typecheck, production build, and Wrangler dry run

The production domain is intentionally **not** configured. The Worker name is `soqnh-online`, so the existing app remains untouched during the rebuild.

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
npm run build              # Production React Router build
npm run check              # Typecheck, build, and Wrangler deploy dry run
npm run db:generate        # Generate a migration after changing app/db/schema.ts
npm run db:migrate:local   # Apply pending migrations to local D1 only
npm run deploy             # Deploy the soqnh-online preview Worker (requires Cloudflare auth)
```

## Cloudflare bindings

| Binding | Resource | Purpose |
| --- | --- | --- |
| `DB` | `nh-solidarity-ecosystem` | Relational app data in D1 |
| `ASSETS` | `nh-ecosystem-assets` | Logos, profile photos, event images, and uploads in R2 |
| `EMAIL` | `no-reply@nhsolidarityecosystem.com` | Magic links and notifications |
| `SCRAPER_RUN_URL` | Partner event scraper Worker URL | Existing scraper integration point |

The health route reports configuration without sending email or listing R2 objects.

### Production data safety

`wrangler.jsonc` includes the existing D1 database ID so the binding is preserved, but `wrangler dev` and `npm run db:migrate:local` use local emulation by default.

Do **not** run a remote migration against the existing D1 database until its current schema has been exported, compared with the new Drizzle model, and tested against a staging copy. Deploying the preview Worker does not apply these migrations or alter the production domain.

## Data model

The first migration establishes:

- identity: `users`, `sessions`, `auth_tokens`, `invitations`
- community graph: `organizations`, `organization_memberships`, `affiliations`, `organization_affiliations`, `user_affiliations`
- content: `posts`, `comments`, `post_reactions`, `post_mentions`
- structured content: `events`, `projects`, `attachments`, `video_embeds`
- operations: `notifications`, `audit_log`

IDs are application-generated UUIDs. Timestamps are stored as ISO-compatible text, binary files stay in R2, and D1 stores only their object keys and metadata.

## Architecture boundaries

- Route modules own request/response behavior and progressive enhancement.
- `app/models` owns server-side application queries.
- `app/lib` owns database construction, HTTP security helpers, and reusable permission rules.
- `app/db/schema.ts` is the typed source of truth for the new schema.
- `workers/app.ts` is deliberately small: it passes Cloudflare bindings and execution context into React Router.
- Long-running scraper work will move to a Queue or Workflow rather than run inside a request.

## Next build slice

Authentication and authorization come next: hashed magic-link tokens, secure sessions, invite acceptance, active/suspended guards, admin routes, and audit events. Organization and affiliation visibility rules should be implemented alongside those guards before content authoring is enabled.
