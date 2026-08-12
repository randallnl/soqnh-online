# Content feeds and permissions

The first Phase 4 slice turns the existing `posts` and `post_tags` tables into the main collaboration workflow. It does not require a D1 migration.

## Sections and routes

The four workspaces map to the existing database section values:

| Route | Database value |
| --- | --- |
| `/legislation` | `legislation` |
| `/events` | `event` |
| `/projects` | `project` |
| `/updates` | `update` |

Each section has a D1-backed feed, organization and tag filters, ten-post pages, authoring entry point, and empty state. `/posts/:postId` is the canonical detail route. `/posts/new` and `/posts/:postId/edit` own creation and editing.

## Visibility

Published posts use two visibility levels:

- `members`: an ecosystem-wide post without an organization is visible to every active member. An organization post is visible to direct organization members and members who share an effective affiliation with that organization.
- `organization`: requires an owning organization and is visible only to direct members of that organization.

Site administrators can see every post. Draft and archived posts are not included in feeds. They remain available by direct URL only to the author, a site administrator, or an organization administrator for the owning organization.

This policy deliberately reuses the effective-affiliation rules in [affiliations.md](affiliations.md). The database predicates enforce access before post data is returned; the interface does not fetch hidden posts and filter them in the browser.

## Authoring and management

- Site administrators can create ecosystem-wide posts or post for any active organization.
- Organization contributors and organization administrators can create posts for their active organizations.
- Viewers cannot create posts.
- Authors can edit their own posts while they retain authoring access to the selected organization.
- Organization administrators can edit or archive posts owned by their organization.
- Site administrators can edit or archive any post.
- Organization-only visibility cannot be selected without an organization.
- Reassigning a post requires authoring permission for the destination organization.

Create and edit actions enforce same-origin form submission and Zod validation. Titles are limited to 180 characters, bodies to 12,000 characters, and posts can carry up to eight normalized tags. IDs use `crypto.randomUUID()`.

## Lifecycle and auditing

Posts can be saved as `draft` or `published`. Archiving removes a post from its section feed without deleting its content or related records. The following audit actions are written:

- `post.created`
- `post.updated`
- `post.archived`

## Next slice

Post detail pages now include comments and one-level reply threads. Any active member who can view a published post can participate. Comment authors can edit or remove their own comments; site administrators and organization administrators for the post's organization can remove comments. Removed parent comments remain as body-free tombstones when they have visible replies, preserving conversation context.

Comment creation, editing, and removal write `comment.created`, `comment.updated`, and `comment.archived` audit events. Draft and archived posts do not accept new conversation activity.

Published posts now support one reversible support reaction per member. Comments and replies can mention one active member who is allowed to see the post; hidden profiles are excluded except for site administrators. Mentions take precedence when a recipient would otherwise receive both a mention and comment notification, preventing duplicate inbox entries. Post authors and reply authors receive comment notifications, while self-notifications are suppressed.

The notification inbox shows the latest 50 currently visible items, supports individual and bulk read states, and filters out activity for posts the member can no longer view. Support changes write `post.supported` and `post.unsupported` audit events.

## Verification

```bash
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
```
