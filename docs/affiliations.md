# Affiliations and organization access

Phase 3 uses the existing `affiliations`, `organization_affiliations`, and `user_affiliations` tables. No D1 migration is required.

## Effective affiliations

An active member's effective affiliations are the union of:

1. Direct affiliations assigned through `user_affiliations`.
2. Affiliations inherited from every non-archived organization where the member has an organization role.

The union removes duplicates. Suspending an account blocks the session immediately through the authentication guard. Archiving an organization stops it from contributing inherited affiliations.

## Organization visibility

Visibility is fail-closed for ordinary members.

- Site administrators can see every active organization in the directory and can open inactive or archived profiles through administration.
- An ordinary member sees an active organization when they are a direct member of it or when one of their effective affiliations matches an affiliation assigned to that organization.
- Direct organization members can still open an inactive organization profile and its management workspace. Archived organizations are site-admin only.
- An organization with no affiliations is not discoverable through shared-network access. A direct member and site administrators can still reach it.
- Organization member lists include only active accounts whose `profile_visibility` is `members`. A member can still see their own row, and site administrators can see hidden rows for administration.

Organization-scoped content in Phase 4 should reuse the same organization visibility predicate. Content marked `organization` should be narrower and require direct membership in the owning organization.

## Administration boundaries

`/admin/affiliations` is site-admin only. Site administrators can:

- create and rename affiliations;
- connect or disconnect non-archived organizations;
- add or remove direct affiliations for active members;
- review direct and effective member counts.

Affiliation mutations write audit events. Affiliations are not deletable in this slice because deleting one would cascade access links and could unexpectedly remove member visibility.

`/organizations/:slug/manage` is available to site administrators and active organization members with the `org_admin` role. Organization administrators can:

- edit their organization's name, summary, description, website, and contact email;
- add or update members who already share one of the organization's affiliations;
- change organization roles and remove other members.

Organization administrators cannot change lifecycle status, URL slugs, or affiliation links. They also cannot demote or remove their own administrator role. Site administrators retain those recovery controls and can assign any active member during onboarding.

## Routes

- `/organizations` — affiliation-filtered active organization directory
- `/organizations/:slug` — visible organization profile and privacy-filtered member list
- `/organizations/:slug/manage` — scoped organization-admin self-service
- `/admin/organizations` — site-admin organization lifecycle and membership management
- `/admin/affiliations` — site-admin affiliation and direct-access management

## Verification

The Workers-runtime test suite covers direct access, inherited access, site-admin bypass, hidden-member privacy, affiliation audits, organization-admin profile changes, scoped membership management, cross-organization denial, and self-demotion denial.

```bash
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
```
