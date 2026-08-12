import { Link } from "react-router";

import type { Route } from "./+types/organizations";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { listOrganizations } from "~/models/organizations.server";

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Organizations · State of Queer NH" },
		{ name: "description", content: "Organizations in New Hampshire’s queer ecosystem." },
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireAuthenticatedUser(request, context.cloudflare.env);
	return { organizations: await listOrganizations(context.cloudflare.env) };
}

function initials(name: string) {
	return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
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
					<strong>No active organizations yet</strong>
				</section>
			) : (
				<section className="organization-card-grid">
					{loaderData.organizations.map((organization) => (
						<Link className="organization-card" key={organization.id} to={`/organizations/${organization.slug}`}>
							<span className="organization-monogram">{initials(organization.name)}</span>
							<div>
								<h2>{organization.name}</h2>
								<p>{organization.summary || "A member organization in the State of Queer NH ecosystem."}</p>
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
