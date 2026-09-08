# Content feeds and permissions

The content workspace uses `posts`, free-form `post_tags`, and first-class `post_affiliations` records for the main collaboration workflow.

## Sections and routes

The four workspaces map to the existing database section values:

| Route | Database value |
| --- | --- |
| `/legislation` | `legislation` |
| `/events` | `event` |
| `/projects` | `project` |
| `/updates` | `update` |

Each section has a D1-backed feed, organization, topic-tag, and affiliation filters, ten-post pages, an authoring entry point, and an empty state. `/posts/:postId` is the canonical detail route. `/posts/new` and `/posts/:postId/edit` own creation and editing.

## Visibility

Published posts use two visibility levels:

- `members`: requires one or more affiliation tags. A member can see the post when at least one post affiliation matches one of their effective affiliations.
- `organization`: requires an owning organization and is visible only to direct members of that organization.

Site administrators can see every post. Draft and archived posts are not included in feeds. They remain available by direct URL only to the author, a site administrator, or an organization administrator for the owning organization.

This policy deliberately reuses the effective-affiliation rules in [affiliations.md](affiliations.md). The database predicates enforce access before post data is returned; the interface does not fetch hidden posts and filter them in the browser. Authors, owning-organization administrators, and site administrators retain direct management access.

Each feed offers checkbox filters containing only the viewer's effective affiliations (or every affiliation for a site administrator). With no filter query, all content visible to the viewer is shown. Submitting a checkbox selection limits shared-network results to posts carrying any selected affiliation; submitting with none selected returns no results. Organization-only content remains available in the unfiltered feed and does not carry affiliation tags.

## Authoring and management

- Site administrators can create ecosystem-wide posts or post for any active organization.
- Organization contributors and organization administrators can create posts for their active organizations.
- Viewers cannot create posts.
- Authors can edit their own posts while they retain authoring access to the selected organization.
- Organization administrators can edit or archive posts owned by their organization.
- Site administrators can edit or archive any post.
- Organization-only visibility cannot be selected without an organization.
- Shared-network content requires at least one affiliation tag. Authors may select only their own effective affiliations; site administrators may select any affiliation.
- Reassigning a post requires authoring permission for the destination organization.

Create and edit actions enforce same-origin form submission and Zod validation. Titles are limited to 180 characters, bodies to 12,000 characters, posts can carry up to eight normalized topic tags, and shared content can carry up to 20 affiliation tags. IDs use `crypto.randomUUID()`.

Migration `0003_clumsy_abomination.sql` creates `post_affiliations`. It backfills existing organization-owned shared posts from their organization's affiliations and existing ecosystem-wide shared posts with all affiliations, preserving pre-migration access. Scraper-created events automatically copy the current affiliations of their owning organization.

## Lifecycle and auditing

Posts can be saved as `draft` or `published`. Archiving removes a post from its section feed without deleting its content or related records. The following audit actions are written:

- `post.created`
- `post.updated`
- `post.archived`

## Conversations and interactions

Post detail pages now include comments and one-level reply threads. Any active member who can view a published post can participate. Comment authors can edit or remove their own comments; site administrators and organization administrators for the post's organization can remove comments. Removed parent comments remain as body-free tombstones when they have visible replies, preserving conversation context.

Comment creation, editing, and removal write `comment.created`, `comment.updated`, and `comment.archived` audit events. Draft and archived posts do not accept new conversation activity.

Published posts now support one reversible support reaction per member. Comments and replies can mention one active member who is allowed to see the post; hidden profiles are excluded except for site administrators. Mentions take precedence when a recipient would otherwise receive both a mention and comment notification, preventing duplicate inbox entries. Post authors and reply authors receive comment notifications, while self-notifications are suppressed.

The notification inbox shows the latest 50 currently visible items, supports individual and bulk read states, and filters out activity for posts the member can no longer view. Support changes write `post.supported` and `post.unsupported` audit events.

## First-class events

Event posts extend the shared content model with schedule, location, registration, source, and image metadata. They use a mandatory moderation workflow and do not appear in the event feed until approved. See [events.md](events.md) for reviewer scope, transitions, and auditing.

## Verification

```bash
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
```
