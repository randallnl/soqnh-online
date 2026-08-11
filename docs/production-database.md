# Production D1 baseline

The existing `nh-solidarity-ecosystem` D1 database is the source of truth for the direct-to-production rebuild.

## Baseline evidence

- Captured: August 11, 2026
- Database ID: `3ddedc39-ef24-45ef-a004-c1080fb73301`
- Schema export: schema only; no application rows were exported
- Export SHA-256: `28d415059c85b7b2277828950e501d0934c3909a8f704087245ddb2c2a1976fc`
- Application tables: 20
- Cloudflare migration table: `d1_migrations`
- Existing legacy migrations: `0001_initial.sql` through `0006_affiliations.sql`
- New Drizzle baseline: `0000_production_baseline.sql`

The Drizzle model and baseline migration match all production columns, defaults, foreign keys, and named indexes. Fresh SQLite databases report primary-key columns as explicitly `NOT NULL`, and Drizzle assigns deterministic names to unique indexes; those are the only expected representation differences from the production export.

The raw schema export is intentionally kept outside Git. The `database-exports/` directory is ignored to prevent a later full data export from being committed accidentally.

## Baseline behavior

`0000_production_baseline.sql` is a complete bootstrap migration for empty local databases. Production already had the equivalent schema from its six legacy migrations, so the baseline is recorded in `d1_migrations` without executing its `CREATE TABLE` statements against production.

Application deployment and database migration are separate operations. `npm run deploy` never applies D1 migrations.

## Production migration checklist

1. Change `app/db/schema.ts`.
2. Generate a named migration with `npm run db:generate -- --name=<change_name>`.
3. Review the generated SQL, especially destructive table-rebuild operations.
4. Apply it to an isolated local database with `npm run db:migrate:local`.
5. Run `npm run check`.
6. Confirm pending production files with `npm run db:migrations:list:remote`.
7. Export the production schema without data and capture a current D1 Time Travel bookmark.
8. Apply the reviewed migration explicitly with Wrangler using the database name and `--remote`.
9. Verify `/health`, the affected application flow, and Worker logs.

Never add a remote migration command to the Cloudflare build or deploy command.
