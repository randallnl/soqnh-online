# Member profiles and identity

Phase 7 uses the existing user profile, organization logo, affiliation, and R2 fields; it does not require a D1 migration.

## Access model

- Members can find active, directory-visible people who share at least one effective affiliation.
- Effective affiliations include both direct user affiliations and affiliations inherited from active or inactive organization memberships. Archived organizations do not confer access.
- Members can always view and edit their own profile. Site administrators can view every active member profile.
- A hidden profile is absent for other members, even when they share an affiliation.
- Profile photo and organization logo bytes are served only through authenticated `/media/*` requests. The media route repeats the database visibility check before reading R2, returns a private cache policy, and never exposes an R2 bucket publicly.

## Routes

- `/members` — affiliation-aware member directory
- `/members/:memberId` — member profile, affiliations, and organization roles
- `/profile` — self-service profile, visibility, affiliation, and photo editing
- `/media/*` — authenticated R2 identity assets
- `/organizations/:slug/manage` — organization profile and logo editing for authorized managers

## Upload controls

Profile photos and organization logos accept PNG, JPEG, WebP, and GIF files up to 2 MB. The server checks the declared MIME type, file signature, and request size before writing to R2. New objects use `profile-photos/{ownerId}-{uuid}.{extension}` or `org-logos/{ownerId}-{uuid}.{extension}`. Replaced objects are deleted only after the D1 update succeeds.

## Verification

The Workers-runtime suite covers shared-affiliation directory access, cross-affiliation denial, private asset authorization, and self-service profile persistence. Type generation, TypeScript checks, the production build, and Wrangler's deployment dry run are part of `npm run check`.
