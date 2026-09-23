import { Form, Link } from "react-router";

import type { Route } from "./+types/public-directory";
import { Icon } from "~/components/icon";
import { directoryFilterValue, uniqueDirectoryOptions } from "~/lib/directory-filters";
import { initials } from "~/lib/media";
import { organizationCategoryTone, parseOrganizationCategories } from "~/lib/organization-categories";
import { listPublishedOrganizations } from "~/models/public-directory.server";

export function meta() {
	return [
		{ title: "NH Connect · New Hampshire Community Directory" },
		{ name: "description", content: "Find queer and BIPOC-affirming organizations, businesses, services, and community resources across New Hampshire." },
	];
}

export function headers() {
	return { "Cache-Control": "no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);
	const filters = {
		query: directoryFilterValue(url.searchParams.get("q"), 160),
		category: directoryFilterValue(url.searchParams.get("category")),
		region: directoryFilterValue(url.searchParams.get("region")),
	};
	const allOrganizations = await listPublishedOrganizations(context.cloudflare.env);
	const query = filters.query.toLocaleLowerCase();
	const organizations = allOrganizations.filter((organization) => {
		if (filters.category && !parseOrganizationCategories(organization.category).includes(filters.category)) return false;
		if (filters.region && organization.region !== filters.region) return false;
		if (!query) return true;
		return [organization.name, organization.summary, organization.townCity, organization.region, ...parseOrganizationCategories(organization.category)]
			.filter(Boolean)
			.join(" ")
			.toLocaleLowerCase()
			.includes(query);
	});
	return {
		organizations,
		totalOrganizations: allOrganizations.length,
		filters,
		categoryOptions: uniqueDirectoryOptions(allOrganizations.flatMap((organization) => parseOrganizationCategories(organization.category))),
		regionOptions: uniqueDirectoryOptions(allOrganizations.map((organization) => organization.region)),
	};
}

export default function PublicDirectory({ loaderData }: Route.ComponentProps) {
	const hasFilters = Boolean(loaderData.filters.query || loaderData.filters.category || loaderData.filters.region);
	return <>
		<section className="public-directory-hero">
			<div className="public-directory-hero-copy">
				<p className="eyebrow">The State of Queer New Hampshire</p>
				<h1>Find community across New Hampshire.</h1>
				<p>Explore organizations, businesses, services, and gathering spaces that have chosen to be part of this public directory.</p>
			</div>
			<div className="public-directory-hero-note"><Icon name="heart" size={24} /><div><strong>Community-maintained</strong><p>Listings are reviewed and updated directly with participating organizations.</p></div></div>
			<p className="public-directory-photo-credit">Photo by Steven Hamilton</p>
		</section>

		<section className="public-directory-content">
			<div className="public-directory-heading"><div><p className="eyebrow">Public directory</p><h2>Explore the ecosystem</h2></div><p>{loaderData.totalOrganizations} {loaderData.totalOrganizations === 1 ? "organization has" : "organizations have"} opted in</p></div>
			<Form className="public-directory-filters" method="get" role="search">
				<label className="public-directory-search"><span>Search the directory</span><div><Icon name="search" size={18} /><input defaultValue={loaderData.filters.query} maxLength={160} name="q" placeholder="Name, service, town, or keyword" type="search" /></div></label>
				<label><span>Category</span><select defaultValue={loaderData.filters.category} name="category"><option value="">All categories</option>{loaderData.categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
				<label><span>Region</span><select defaultValue={loaderData.filters.region} name="region"><option value="">All regions</option>{loaderData.regionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
				<div className="public-directory-filter-actions"><button className="button button--primary" type="submit">Apply filters</button>{hasFilters && <Link to="/">Clear</Link>}</div>
			</Form>
			<p className="public-directory-result-count">Showing {loaderData.organizations.length} of {loaderData.totalOrganizations} listings</p>

			{loaderData.organizations.length === 0 ? <div className="public-directory-empty"><Icon name="building" size={30} /><h3>{hasFilters ? "No listings match those filters" : "The directory is getting ready"}</h3><p>{hasFilters ? "Try another search or clear the current filters." : "Approved organizations will appear here as they opt in."}</p>{hasFilters && <Link className="button button--secondary" to="/">Clear filters</Link>}</div> : <div className="public-directory-grid">{loaderData.organizations.map((organization) => {
				const categories = parseOrganizationCategories(organization.category);
				return <Link className="public-directory-card" key={organization.slug} to={`/directory/${organization.slug}`}>
					<div className={`public-directory-card-cover${organization.hasProfilePhoto ? " public-directory-card-cover--photo" : ""}`}>{organization.hasProfilePhoto && <img alt="" loading="lazy" src={`/directory/${encodeURIComponent(organization.slug)}/media/photo`} />}</div>
					<div className="public-directory-card-body">
						<span className="public-directory-logo">{organization.hasLogo ? <img alt="" loading="lazy" src={`/directory/${encodeURIComponent(organization.slug)}/media/logo`} /> : initials(organization.name, "Organization")}</span>
						<h3>{organization.name}</h3>
						<p>{organization.summary || "An affirming organization in New Hampshire’s community ecosystem."}</p>
						{categories.length > 0 && <div className="public-directory-tags">{categories.slice(0, 3).map((category) => <span className={`organization-category-chip organization-category-tone--${organizationCategoryTone(category)}`} key={category}>{category}</span>)}</div>}
					</div>
					<footer><span>{organization.operatesStatewide === 1 ? "Statewide" : [organization.townCity, organization.region].filter(Boolean).join(" · ") || "New Hampshire"}</span><span>View profile <Icon name="chevron-right" size={16} /></span></footer>
				</Link>;
			})}</div>}
		</section>
	</>;
}
