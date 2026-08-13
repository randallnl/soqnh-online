# Partner event scraper

Phase 6 connects the existing `parter-event-scraper` Worker to the React Router application without moving scraping logic into a request handler. The scraper remains responsible for fetching and parsing partner websites. `soqnh-online` owns source configuration, authenticated callbacks, duplicate decisions, moderation, and operational history.

## Contract

The scraper uses a shared `SCRAPER_API_TOKEN` bearer secret for both callback routes:

- `GET /api/scraper/organizations` returns active, enabled organizations as `{ name, url, parser }` records.
- `POST /api/scraper/events` accepts `{ records: [...] }`, with at most 500 records and a one-megabyte request body.

Manual runs are started from `/admin/scraper`. The app sends `SCRAPER_ADMIN_TOKEN` to `SCRAPER_RUN_URL`, bounds the response to 64 KiB, records success metrics, and records a failure message when the scraper cannot complete. The current manual trigger waits for the existing Worker response; a future move to Cloudflare Workflows or Queues should preserve this callback contract.

Both tokens are secrets. `.dev.vars.example` documents local names, while `.dev.vars` and production secret values remain outside Git.

## Import decisions

Every received record creates a `scraper_imports` decision row:

- `imported`: a new private draft event was created for moderation.
- `updated`: the same scraper identity was found in a pending or rejected event, its details were refreshed, and it returned to pending moderation.
- `duplicate`: an approved scraper identity or a likely existing event matched. No event content was changed.
- `invalid`: the record failed validation, was not an event, or did not match an active organization.

The stable identity hashes organization, source/event URL, normalized title, and start date. A second likely-match pass compares organization plus title/date and known event URLs. Approved events are never silently overwritten.

Scraped events are authored by the hidden `system:event-scraper` account. New and updated records use the same Phase 5 moderation queue as member-submitted events.

## Administration

Only site administrators can open `/admin/scraper`. The screen provides:

- per-organization source URL, parser, and enabled controls;
- a manual run action;
- the 25 most recent run summaries;
- the 100 most recent import decisions with links to imported events;
- a direct link to the event moderation queue.

Organization scraper-setting changes are written to `audit_log`.

## Production activation

Activation is an explicit release operation:

1. Apply the Phase 6 D1 migration before deploying code that writes run/import rows.
2. Set matching `SCRAPER_API_TOKEN` secrets on both Workers.
3. Set `SCRAPER_ADMIN_TOKEN` on `soqnh-online` to the Partner Event Scraper manual-run secret.
4. Change the Partner Event Scraper `ECOSYSTEM_BASE_URL` to the production `soqnh-online` origin and deploy it.
5. Deploy `soqnh-online`, verify `/health`, run one manual scrape, and review the import decisions and moderation queue.

The existing scraper cron remains responsible for scheduled runs after its callback origin is changed.
