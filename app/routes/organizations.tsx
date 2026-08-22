import { Link } from "react-router";

import type { Route } from "./+types/organizations";
import { Icon } from "~/components/icon";
import { OrganizationIdentity } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { listVisibleOrganizations } from "~/models/organizations.server";

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Organizations · State of Queer NH" },
		{ name: "description", content: "Organizations in New Hampshire’s queer ecosystem." },
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	return { organizations: await listVisibleOrganizations(context.cloudflare.env, user) };
}

export default function Organizations({ loaderData }: Route.ComponentProps) {
	return (
		<div className="organization-page">
			<section className="page-heading">
				<div>
					<p className="eyebrow">Community graph</p>
					<h1>Organizations</h1>
					<p>Meet the groups building support, connection, and power across New Hampshire.</p>
				</div>
			</section>

			{loaderData.organizations.length === 0 ? (
				<section className="panel empty-state">
					<Icon name="building" size={26} />
					<strong>No organizations are visible in your network yet</strong>
					<p>Your organization or direct affiliations determine which groups appear here.</p>
				</section>
			) : (
				<section className="organization-card-grid">
					{loaderData.organizations.map((organization) => (
						<Link className="organization-card" key={organization.id} to={`/organizations/${organization.slug}`}>
							<OrganizationIdentity logoObjectKey={organization.logoObjectKey} name={organization.name} />
							<div>
								<h2>{organization.name}</h2>
								<p>{organization.summary || "A member organization in the State of Queer NH ecosystem."}</p>
								{organization.affiliations.length > 0 && (
									<div className="affiliation-chip-row">
										{organization.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}
									</div>
								)}
							</div>
							<footer>
								<span><Icon name="people" size={15} /> {organization.memberCount} {organization.memberCount === 1 ? "member" : "members"}</span>
								<Icon name="chevron-right" size={17} />
							</footer>
						</Link>
					))}
				</section>
			)}
		</div>
	);
}
