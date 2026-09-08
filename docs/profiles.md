# Member profiles and identity

Member profiles combine user identity, organization memberships, affiliation access, and private R2-backed images. Organization membership claims are stored separately from approved memberships so self-service requests never grant access before moderation.

New members who accept an invitation are taken directly to profile onboarding. Workspace routes remain gated until the member saves their name, optional identity details, visibility preference, and direct affiliations. Organization claims become available after onboarding is complete.

## Access model

- Members can find active, directory-visible people who share at least one effective affiliation.
- Effective affiliations include both direct user affiliations and affiliations inherited from active or inactive organization memberships. Archived organizations do not confer access.
- Members can always view and edit their own profile. Site administrators can view every active member profile.
- A hidden profile is absent for other members, even when they share an affiliation.
- Member profile pages show every non-archived organization membership and its approved role.
- Profile photo and organization logo bytes are served only through authenticated `/media/*` requests. The media route repeats the database visibility check before reading R2, returns a private cache policy, and never exposes an R2 bucket publicly.

## Routes

- `/members` — affiliation-aware member directory
- `/members/:memberId` — member profile, affiliations, and organization roles
- `/profile` — self-service profile, visibility, affiliation, and photo editing
- `/media/*` — authenticated R2 identity assets
- `/organizations/:slug/manage` — organization profile and logo editing for authorized managers

## Organization membership claims

Members can submit an organization claim from `/profile`, selecting an active organization already visible through their direct membership or effective affiliations and one of three requested roles: member, contributor, or organization administrator. Site administrators may select any active organization. The same workflow supports a new membership or a requested role change. A member may have only one pending claim per organization, may cancel it while pending, and may resubmit after cancellation or rejection.

A claim does not change `organization_memberships` until approval. Site administrators review all pending claims in `/admin/organizations`; organization administrators review only claims for their own organization in `/organizations/:slug/manage`. Reviewers cannot approve or reject their own claims. Rejection requires a reason. Approval upserts the requested role, and both decisions notify the claimant and write audit records.

Migration `0004_real_wendell_vaughn.sql` creates `organization_membership_claims`, including a partial unique index that prevents duplicate pending claims.

## Upload controls

Profile photos and organization logos accept PNG, JPEG, WebP, and GIF files up to 2 MB. The server checks the declared MIME type, file signature, and request size before writing to R2. New objects use `profile-photos/{ownerId}-{uuid}.{extension}` or `org-logos/{ownerId}-{uuid}.{extension}`. Replaced objects are deleted only after the D1 update succeeds.

## Verification

The Workers-runtime suite covers shared-affiliation directory access, cross-affiliation denial, private asset authorization, self-service profile persistence, pending claims, scoped review, self-review denial, cancellation, rejection, approval, membership activation, notifications, and audit records. Type generation, TypeScript checks, the production build, and Wrangler's deployment dry run are part of `npm run check`.
