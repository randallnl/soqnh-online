# Events and moderation

Phase 5 makes events a structured workflow built on the existing `posts` and `events` tables. A small forward migration adds moderation state and reviewer metadata without removing or renaming existing event fields. Existing published events are marked approved when the migration runs.

## Event details

Every manually created event requires a start date and time. End date and time, location name, location URL, registration URL, original source URL, and an image URL are optional. URL fields accept only complete URLs. End times cannot precede start times.

The events feed orders approved events by start time and presents schedule, location, and image information as event-specific cards. Event detail pages show registration and original-source links alongside the normal post conversation.

## Moderation lifecycle

New events are always stored as private draft posts with `pending` event moderation status, even when submitted by a moderator. This guarantees that publication is an explicit review action.

- Site administrators can review every pending event.
- Organization administrators can review pending events owned by their organization.
- Contributors can submit and revise events for organizations where they hold that role, but cannot approve them.
- Unrelated organization administrators and ordinary members cannot read or mutate another organization's moderation queue.
- Approval changes the event to `approved` and publishes its post.
- Rejection changes the event to `rejected`, keeps its post private, and requires a reason.
- Editing an approved or rejected event clears the old review metadata and returns it to `pending` as a private draft.
- Conditional review writes prevent a second moderator from overwriting an event that was already reviewed.

Authors can always open their own pending or rejected event by direct URL. The rejection reason is shown only within that visibility boundary. Published-feed visibility continues to use the same organization and affiliation predicates as other content.

## Notifications and auditing

Approval and rejection notify the event author in the existing inbox unless the reviewer is also the author. Notifications retain the normal visibility filtering, including author access to rejected drafts.

The workflow writes:

- `event.submitted` when an event is created or materially edited
- `event.approved` when a moderator publishes it
- `event.rejected` with the reviewer reason in audit metadata

## Deferred to Phase 6

Scraper triggers, schedules, import previews, duplicate matching, approval of imported records, and run history remain a separate background-work phase. This moderation workflow is the stable destination those imports will use.
