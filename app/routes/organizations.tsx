import { Form, Link } from "react-router";

import type { Route } from "./+types/organizations";
import { Icon } from "~/components/icon";
import { OrganizationIdentity } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { directoryFilterValue, filterOrganizations, uniqueDirectoryOptions } from "~/lib/directory-filters";
import { organizationCategoryTone, parseOrganizationCategories } from "~/lib/organization-categories";
import { listVisibleOrganizations } from "~/models/organizations.server";

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Organizations · NH Connect" },
		{ name: "description", content: "Organizations in New Hampshire’s queer ecosystem." },
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const url = new URL(request.url);
	const baseFilters = {
		query: directoryFilterValue(url.searchParams.get("q"), 160),
		category: directoryFilterValue(url.searchParams.get("category")),
		region: directoryFilterValue(url.searchParams.get("region")),
	};
	const requestedAffiliationId = directoryFilterValue(url.searchParams.get("affiliation"), 100);
	const allOrganizations = await listVisibleOrganizations(context.cloudflare.env, user);
	const affiliationOptions = [...new Map(allOrganizations.flatMap((organization) => organization.affiliations).map((affiliation) => [affiliation.id, affiliation])).values()]
		.sort((left, right) => left.name.localeCompare(right.name));
	const filters = {
		...baseFilters,
		affiliationId: affiliationOptions.some((affiliation) => affiliation.id === requestedAffiliationId) ? requestedAffiliationId : "",
	};
	return {
		organizations: filterOrganizations(allOrganizations, filters),
		totalOrganizations: allOrganizations.length,
		filters,
		categoryOptions: uniqueDirectoryOptions(allOrganizations.flatMap((organization) => parseOrganizationCategories(organization.category))),
		regionOptions: uniqueDirectoryOptions(allOrganizations.map((organization) => organization.region)),
		affiliationOptions,
	};
}

export default function Organizations({ loaderData }: Route.ComponentProps) {
	const hasFilters = Boolean(loaderData.filters.query || loaderData.filters.category || loaderData.filters.region || loaderData.filters.affiliationId);
	return (
		<div className="organization-page">
			<section className="page-heading">
				<div>
					<p className="eyebrow">Community graph</p>
					<h1>Organizations</h1>
					<p>Meet the groups building support, connection, and power across New Hampshire. Affiliation labels are only shown for coalitions you belong to.</p>
				</div>
			</section>
			<Form className="panel directory-filter-panel" method="get" role="search">
				<label className="directory-search-field">Search organizations<span><Icon name="search" size={17} /><input defaultValue={loaderData.filters.query} maxLength={160} name="q" placeholder="Name, service, town, or keyword" type="search" /></span></label>
				<label>Category<select defaultValue={loaderData.filters.category} name="category" onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="">All categories</option>{loaderData.categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
				<label>Region<select defaultValue={loaderData.filters.region} name="region" onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="">All regions</option>{loaderData.regionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
				{loaderData.affiliationOptions.length > 0 && (
					<label>Affiliation<select defaultValue={loaderData.filters.affiliationId} name="affiliation" onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="">All affiliations</option>{loaderData.affiliationOptions.map((affiliation) => <option key={affiliation.id} value={affiliation.id}>{affiliation.name}</option>)}</select></label>
				)}
				<div className="directory-filter-actions"><button className="button button--secondary" type="submit"><Icon name="search" size={16} /> Search</button>{hasFilters && <Link to="/organizations">Clear</Link>}</div>
			</Form>
			<p className="directory-result-count">Showing {loaderData.organizations.length} of {loaderData.totalOrganizations} {loaderData.totalOrganizations === 1 ? "organization" : "organizations"}</p>

			{loaderData.organizations.length === 0 ? (
				<section className="panel empty-state">
					<Icon name="building" size={26} />
					<strong>{hasFilters ? "No organizations match these filters" : "No active organizations are listed yet"}</strong>
					<p>{hasFilters ? "Try a broader search or clear the current filters." : "Active organizations will appear here for every signed-in member."}</p>
					{hasFilters && <Link className="button button--secondary" to="/organizations">Clear filters</Link>}
				</section>
			) : (
				<section className="organization-card-grid">
					{loaderData.organizations.map((organization) => (
						<Link className="organization-card" key={organization.id} to={`/organizations/${organization.slug}`}>
							<OrganizationIdentity logoObjectKey={organization.logoObjectKey} name={organization.name} />
							<div>
								<h2>{organization.name}</h2>
								<p>{organization.summary || "A member organization in the NH Connect community network."}</p>
								{parseOrganizationCategories(organization.category).length > 0 && (
									<div className="organization-category-row">
										{parseOrganizationCategories(organization.category).map((category) => <span className={`organization-category-chip organization-category-tone--${organizationCategoryTone(category)}`} key={category}>{category}</span>)}
									</div>
								)}
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
