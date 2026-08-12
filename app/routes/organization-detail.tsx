import { Link } from "react-router";

import type { Route } from "./+types/organization-detail";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { getOrganizationBySlug } from "~/models/organizations.server";

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.organization.name ?? "Organization"} · State of Queer NH` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = await getOrganizationBySlug(context.cloudflare.env, params.slug);
	if (!result || (result.organization.status !== "active" && user.siteRole !== "site_admin")) {
		throw new Response("Organization not found", { status: 404 });
	}
	return result;
}

function initials(value: string) {
	return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export default function OrganizationDetail({ loaderData }: Route.ComponentProps) {
	const { organization, members } = loaderData;
	return (
		<div className="organization-detail-page">
			<Link className="back-link" to="/organizations">← All organizations</Link>
			<section className="organization-profile panel">
				<div className="organization-profile-header">
					<span className="organization-monogram organization-monogram--large">{initials(organization.name)}</span>
					<div>
						<p className="eyebrow">Ecosystem organization</p>
						<h1>{organization.name}</h1>
						<p>{organization.summary || "A member organization in the State of Queer NH ecosystem."}</p>
					</div>
				</div>
				{organization.description && <p className="organization-description">{organization.description}</p>}
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
							<article key={member.userId}>
								<span className="avatar">{initials(member.name || member.email)}</span>
								<div><strong>{member.name || member.email}</strong><p>{roleLabels[member.role]}</p></div>
							</article>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
