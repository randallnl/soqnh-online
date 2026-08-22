import { Link } from "react-router";

import type { Route } from "./+types/members";
import { IdentityAvatar } from "~/components/identity-avatar";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { listVisibleMembers } from "~/models/profiles.server";

export function meta() {
	return [{ title: "Members · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	return { user, members: await listVisibleMembers(context.cloudflare.env, user) };
}

export default function Members({ loaderData }: Route.ComponentProps) {
	return <div className="member-directory-page">
		<section className="page-heading"><div><p className="eyebrow">Member directory</p><h1>People in the ecosystem</h1><p>Find collaborators, organizers, and community contacts across your affiliation network.</p></div><Link className="button button--secondary heading-action" to="/profile"><Icon name="settings" size={17} /> Edit your profile</Link></section>
		{loaderData.members.length === 0 ? <section className="panel empty-state"><Icon name="people" size={28} /><strong>No member profiles are visible yet</strong><p>Profiles appear here when people in your affiliations make them visible.</p></section> : <section className="member-card-grid" aria-label="Member profiles">{loaderData.members.map((member) => <Link className="panel member-profile-card" key={member.id} to={`/members/${member.id}`}>
			<IdentityAvatar name={member.name} objectKey={member.avatarObjectKey} size="large" />
			<div><h2>{member.name || "Member"}</h2><p className="member-profile-title">{member.profileTitle || member.organizationNames || "Ecosystem member"}</p><div className="member-profile-meta">{member.pronouns && <span>{member.pronouns}</span>}{member.location && <span>{member.location}</span>}</div>{member.affiliationNames && <p className="member-affiliation-line">{member.affiliationNames}</p>}{member.bio && <p className="member-card-bio">{member.bio.length > 150 ? `${member.bio.slice(0, 147)}…` : member.bio}</p>}</div>
			<Icon className="member-card-arrow" name="chevron-right" size={18} />
		</Link>)}</section>}
	</div>;
}
