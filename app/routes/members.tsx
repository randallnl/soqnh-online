import { Form, Link } from "react-router";

import type { Route } from "./+types/members";
import { IdentityAvatar } from "~/components/identity-avatar";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { directoryFilterValue, filterMembers, uniqueDirectoryOptions } from "~/lib/directory-filters";
import { listVisibleOrganizations } from "~/models/organizations.server";
import { listVisibleMembers } from "~/models/profiles.server";

export function meta() {
	return [{ title: "Members · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const url = new URL(request.url);
	const filters = {
		query: directoryFilterValue(url.searchParams.get("q"), 160),
		organizationId: directoryFilterValue(url.searchParams.get("organization"), 100),
		location: directoryFilterValue(url.searchParams.get("location"), 200),
	};
	const [allMembers, visibleOrganizations] = await Promise.all([
		listVisibleMembers(context.cloudflare.env, user),
		listVisibleOrganizations(context.cloudflare.env, user),
	]);
	return {
		user,
		members: filterMembers(allMembers, filters),
		totalMembers: allMembers.length,
		filters,
		organizationOptions: visibleOrganizations.map((organization) => ({ id: organization.id, name: organization.name })),
		locationOptions: uniqueDirectoryOptions(allMembers.map((member) => member.location)),
	};
}

export default function Members({ loaderData }: Route.ComponentProps) {
	const hasFilters = Boolean(loaderData.filters.query || loaderData.filters.organizationId || loaderData.filters.location);
	return <div className="member-directory-page">
		<section className="page-heading"><div><p className="eyebrow">Member directory</p><h1>People in the ecosystem</h1><p>Find collaborators, organizers, and community contacts across your affiliation network.</p></div><Link className="button button--secondary heading-action" to="/profile"><Icon name="settings" size={17} /> Edit your profile</Link></section>
		<Form className="panel directory-filter-panel directory-filter-panel--members" method="get" role="search">
			<label className="directory-search-field">Search members<span><Icon name="search" size={17} /><input defaultValue={loaderData.filters.query} maxLength={160} name="q" placeholder="Name, role, location, or keyword" type="search" /></span></label>
			<label>Organization<select defaultValue={loaderData.filters.organizationId} name="organization" onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="">All organizations</option>{loaderData.organizationOptions.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
			<label>Location<select defaultValue={loaderData.filters.location} name="location" onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="">All locations</option>{loaderData.locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
			<div className="directory-filter-actions"><button className="button button--secondary" type="submit"><Icon name="search" size={16} /> Search</button>{hasFilters && <Link to="/members">Clear</Link>}</div>
		</Form>
		<p className="directory-result-count">Showing {loaderData.members.length} of {loaderData.totalMembers} visible {loaderData.totalMembers === 1 ? "member" : "members"}</p>
		{loaderData.members.length === 0 ? <section className="panel empty-state"><Icon name="people" size={28} /><strong>{hasFilters ? "No members match these filters" : "No member profiles are visible yet"}</strong><p>{hasFilters ? "Try a broader search or clear the current filters." : "Profiles appear here when people in your affiliations make them visible."}</p>{hasFilters && <Link className="button button--secondary" to="/members">Clear filters</Link>}</section> : <section className="member-card-grid" aria-label="Member profiles">{loaderData.members.map((member) => <Link className="panel member-profile-card" key={member.id} to={`/members/${member.id}`}>
			<IdentityAvatar name={member.name} objectKey={member.avatarObjectKey} size="large" />
			<div><h2>{member.name || "Member"}</h2><p className="member-profile-title">{member.profileTitle || member.organizationNames || "Ecosystem member"}</p><div className="member-profile-meta">{member.pronouns && <span>{member.pronouns}</span>}{member.location && <span>{member.location}</span>}</div>{member.affiliationNames && <p className="member-affiliation-line">{member.affiliationNames}</p>}{member.bio && <p className="member-card-bio">{member.bio.length > 150 ? `${member.bio.slice(0, 147)}…` : member.bio}</p>}</div>
			<Icon className="member-card-arrow" name="chevron-right" size={18} />
		</Link>)}</section>}
	</div>;
}
