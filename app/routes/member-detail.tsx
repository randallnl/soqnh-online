import { Link } from "react-router";

import type { Route } from "./+types/member-detail";
import { IdentityAvatar, OrganizationIdentity } from "~/components/identity-avatar";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { getVisibleMemberProfile } from "~/models/profiles.server";

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.member.name || "Member"} · State of Queer NH` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const member = await getVisibleMemberProfile(context.cloudflare.env, user, params.memberId);
	if (!member) throw new Response("Member not found", { status: 404 });
	return { user, member };
}

export default function MemberDetail({ loaderData }: Route.ComponentProps) {
	const { member, user } = loaderData;
	return <div className="member-detail-page">
		<div className="organization-detail-actions"><Link className="back-link" to="/members">← All members</Link>{member.id === user.id && <Link className="button button--secondary button--compact" to="/profile"><Icon name="settings" size={16} /> Edit profile</Link>}</div>
		<section className="panel member-profile-hero"><div className="member-profile-identity"><IdentityAvatar name={member.name} objectKey={member.avatarObjectKey} size="large" /><div><p className="eyebrow">Member profile</p><h1>{member.name || "Member"}</h1><p>{member.profileTitle || "Ecosystem member"}</p><div className="member-profile-meta">{member.pronouns && <span>{member.pronouns}</span>}{member.location && <span>{member.location}</span>}{member.siteRole === "site_admin" && <span>Site administrator</span>}</div></div></div>
			{member.affiliations.length > 0 && <div className="affiliation-chip-row member-profile-affiliations">{member.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>}
			<p className="member-profile-bio">{member.bio || "This member has not added a bio yet."}</p>
			{member.websiteUrl && <a className="button button--secondary button--compact member-website-link" href={member.websiteUrl} rel="noreferrer" target="_blank"><Icon name="activity" size={16} /> Visit website</a>}
		</section>
		<section className="panel member-organizations-panel"><div className="panel-heading"><div><p className="eyebrow">Community roles</p><h2>Organizations</h2></div><span>{member.organizations.length}</span></div>{member.organizations.length === 0 ? <p className="muted-empty member-panel-empty">No organizations linked yet.</p> : <div className="member-organization-list">{member.organizations.map((organization) => <Link key={organization.id} to={`/organizations/${organization.slug}`}><OrganizationIdentity logoObjectKey={organization.logoObjectKey} name={organization.name} /><div><strong>{organization.name}</strong><p>{organization.role === "org_admin" ? "Organization administrator" : organization.role === "contributor" ? "Contributor" : "Member"}</p></div><Icon name="chevron-right" size={16} /></Link>)}</div>}</section>
	</div>;
}
