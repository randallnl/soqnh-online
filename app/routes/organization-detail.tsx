import { Link } from "react-router";

import type { Route } from "./+types/organization-detail";
import { Icon } from "~/components/icon";
import { IdentityAvatar, OrganizationIdentity } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { getOrganizationBySlug } from "~/models/organizations.server";

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.organization.name ?? "Organization"} · State of Queer NH` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = await getOrganizationBySlug(context.cloudflare.env, params.slug, user);
	if (!result) {
		throw new Response("Organization not found", { status: 404 });
	}
	return {
		...result,
		canManage:
			user.siteRole === "site_admin" ||
			result.members.some((member) => member.userId === user.id && member.role === "org_admin"),
	};
}

export default function OrganizationDetail({ loaderData }: Route.ComponentProps) {
	const { organization, members } = loaderData;
	return (
		<div className="organization-detail-page">
			<div className="organization-detail-actions">
				<Link className="back-link" to="/organizations">← All organizations</Link>
				{loaderData.canManage && <Link className="button button--secondary button--compact" to={`/organizations/${organization.slug}/manage`}><Icon name="settings" size={16} /> Manage organization</Link>}
			</div>
			<section className="organization-profile panel">
				<div className="organization-profile-header">
					<OrganizationIdentity large logoObjectKey={organization.logoObjectKey} name={organization.name} />
					<div>
						<p className="eyebrow">Ecosystem organization</p>
						<h1>{organization.name}</h1>
						<p>{organization.summary || "A member organization in the State of Queer NH ecosystem."}</p>
					</div>
				</div>
				{organization.description && <p className="organization-description">{organization.description}</p>}
				{organization.affiliations.length > 0 && (
					<div className="organization-affiliations">
						<p className="eyebrow">Affiliations</p>
						<div className="affiliation-chip-row">{organization.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>
					</div>
				)}
				<div className="organization-contact-row">
					{organization.websiteUrl && <a href={organization.websiteUrl} rel="noreferrer" target="_blank"><Icon name="activity" size={16} /> Visit website</a>}
					{organization.contactEmail && <a href={`mailto:${organization.contactEmail}`}><Icon name="message" size={16} /> {organization.contactEmail}</a>}
				</div>
			</section>

			<section className="panel organization-member-panel">
				<div className="panel-heading"><div><p className="eyebrow">People</p><h2>Organization members</h2></div><span>{members.length}</span></div>
				{members.length === 0 ? <div className="empty-state empty-state--compact"><strong>No active members listed</strong></div> : (
					<div className="organization-member-list">
						{members.map((member) => (
							<Link className="organization-member-link" key={member.userId} to={`/members/${member.userId}`}>
								<IdentityAvatar name={member.name || "Member"} objectKey={member.avatarObjectKey} />
								<div><strong>{member.name || "Member"}</strong><p>{roleLabels[member.role]}</p></div>
							</Link>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
