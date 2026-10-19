import { Form, Link } from "react-router";

import type { Route } from "./+types/search";
import { Icon, type IconName } from "~/components/icon";
import { IdentityAvatar, OrganizationIdentity } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { mediaUrl } from "~/lib/media";
import { searchWorkspace, type SearchContentResult } from "~/models/search.server";

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data?.query ? `Search: ${data.query} · NH Connect` : "Search · NH Connect" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
	return { query, results: await searchWorkspace(context.cloudflare.env, user, query) };
}

function excerpt(value: string, length = 150) {
	const compact = value.replace(/\s+/g, " ").trim();
	return compact.length > length ? `${compact.slice(0, length - 1).trimEnd()}…` : compact;
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function SearchContentGroup({
	title,
	description,
	icon,
	items,
}: {
	title: string;
	description: string;
	icon: IconName;
	items: SearchContentResult[];
}) {
	if (items.length === 0) return null;
	return <section className="panel search-result-group">
		<header><span><Icon name={icon} size={19} /></span><div><h2>{title}</h2><p>{description}</p></div><b>{items.length}</b></header>
		<div className="search-result-list">{items.map((item) => {
			const thumbnailUrl = mediaUrl(item.thumbnailObjectKey) ?? item.thumbnailUrl;
			return <Link className="search-content-result" key={item.id} to={`/posts/${item.id}`}>
				<div className="search-result-copy">
					<h3>{item.title}</h3>
					<p>{excerpt(item.body)}</p>
					<div className="search-result-meta">
						{item.organizationName && <span className="search-result-organization">{item.organizationSlug && <span className="search-result-logo"><OrganizationIdentity logoObjectKey={item.organizationLogoObjectKey} name={item.organizationName} /></span>}<strong>{item.organizationName}</strong></span>}
						<span>{item.section === "event" && item.eventStartsAt ? formatDate(item.eventStartsAt) : formatDate(item.createdAt)}{item.eventLocationName ? ` · ${item.eventLocationName}` : ""}</span>
					</div>
				</div>
				{thumbnailUrl && <img alt="" className="search-result-thumbnail" loading="lazy" referrerPolicy={item.thumbnailObjectKey ? undefined : "no-referrer"} src={thumbnailUrl} />}
				<Icon className="search-result-arrow" name="chevron-right" size={17} />
			</Link>;
		})}</div>
	</section>;
}

export default function Search({ loaderData }: Route.ComponentProps) {
	const { query, results } = loaderData;
	const total = results.organizations.length + results.members.length + results.events.length + results.projects.length + results.updates.length;
	const searched = query.length >= 2;
	return <div className="workspace-search-page">
		<section className="page-heading"><div><p className="eyebrow">Find anything</p><h1>Search NH Connect</h1><p>Find people, organizations, events, projects, and community updates you have access to.</p></div></section>
		<Form className="panel workspace-search-form" method="get" role="search">
			<label htmlFor="workspace-search">Search the workspace</label>
			<div><Icon name="search" size={20} /><input autoFocus defaultValue={query} id="workspace-search" maxLength={100} name="q" placeholder="Try an organization, person, topic, town, or event" type="search" /><button className="button button--primary" type="submit">Search</button></div>
		</Form>
		{!searched ? <section className="panel search-welcome-state"><span><Icon name="search" size={28} /></span><div><strong>What are you looking for?</strong><p>Enter at least two characters. Search results only include content and profiles visible to you.</p></div></section> : total === 0 ? <section className="panel empty-state search-empty-state"><Icon name="search" size={30} /><strong>No results for “{query}”</strong><p>Try a person’s name, an organization, a town, or fewer keywords.</p></section> : <>
			<p className="search-result-summary">{total} {total === 1 ? "result" : "results"} for <strong>“{query}”</strong></p>
			<div className="search-result-groups">
				{results.organizations.length > 0 && <section className="panel search-result-group">
					<header><span><Icon name="building" size={19} /></span><div><h2>Organizations</h2><p>Groups and community partners</p></div><b>{results.organizations.length}</b></header>
					<div className="search-identity-grid">{results.organizations.map((organization) => <Link className="search-identity-result" key={organization.id} to={`/organizations/${organization.slug}`}><OrganizationIdentity logoObjectKey={organization.logoObjectKey} name={organization.name} /><div><h3>{organization.name}</h3><p>{organization.summary || [organization.category, organization.townCity, organization.region].filter(Boolean).join(" · ") || "View organization profile"}</p></div><Icon name="chevron-right" size={16} /></Link>)}</div>
				</section>}
				{results.members.length > 0 && <section className="panel search-result-group">
					<header><span><Icon name="people" size={19} /></span><div><h2>Members</h2><p>People in the member network</p></div><b>{results.members.length}</b></header>
					<div className="search-identity-grid">{results.members.map((member) => <Link className="search-identity-result" key={member.id} to={`/members/${member.id}`}><IdentityAvatar name={member.name || "Member"} objectKey={member.avatarObjectKey} /><div><h3>{member.name || "Member"}</h3><p>{member.profileTitle || member.organizationNames || member.location || "View member profile"}</p></div><Icon name="chevron-right" size={16} /></Link>)}</div>
				</section>}
				<SearchContentGroup description="Upcoming and published community events" icon="calendar" items={results.events} title="Events" />
				<SearchContentGroup description="Active work and collaboration opportunities" icon="clipboard" items={results.projects} title="Projects" />
				<SearchContentGroup description="News, questions, and community conversation" icon="message" items={results.updates} title="Community Feed" />
			</div>
		</>}
	</div>;
}
