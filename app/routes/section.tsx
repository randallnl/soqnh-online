import { Form, Link } from "react-router";

import type { Route } from "./+types/section";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { isContentSection, sectionDefinitions } from "~/lib/content";
import { formatEventDateTime } from "~/lib/events";
import { listVisibleOrganizations } from "~/models/organizations.server";
import { listPostOrganizations, listSectionPosts } from "~/models/posts.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	if (!isContentSection(params.section)) throw new Response("Not found", { status: 404 });
	const url = new URL(request.url);
	const rawPage = Number(url.searchParams.get("page") ?? "1");
	const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000) : 1;
	const tag = url.searchParams.get("tag")?.trim().toLowerCase() || null;
	const organizationId = url.searchParams.get("organization")?.trim() || null;
	const section = sectionDefinitions[params.section];
	const [feed, visibleOrganizations, authoringOrganizations] = await Promise.all([
		listSectionPosts(context.cloudflare.env, user, { section: section.databaseValue, tag, organizationId, page }),
		listVisibleOrganizations(context.cloudflare.env, user),
		listPostOrganizations(context.cloudflare.env, user),
	]);
	return {
		sectionKey: params.section,
		section,
		feed,
		visibleOrganizations,
		canCreate: user.siteRole === "site_admin" || authoringOrganizations.length > 0,
		canModerateEvents: user.siteRole === "site_admin" || authoringOrganizations.some((organization) => organization.role === "org_admin"),
		filters: { tag, organizationId },
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.section.title ?? "Workspace"} · State of Queer NH` }];
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function pageUrl(section: string, page: number, tag: string | null, organizationId: string | null) {
	const search = new URLSearchParams();
	if (page > 1) search.set("page", String(page));
	if (tag) search.set("tag", tag);
	if (organizationId) search.set("organization", organizationId);
	return `/${section}${search.size ? `?${search}` : ""}`;
}

export default function Section({ loaderData }: Route.ComponentProps) {
	const { section, sectionKey, feed, filters } = loaderData;
	return (
		<div className="section-page content-section-page">
			<section className="section-hero">
				<div className="section-hero-copy">
					<span className="section-hero-icon"><Icon name={section.icon} size={24} /></span>
					<div><p className="eyebrow">{section.eyebrow}</p><h1>{section.title}</h1><p>{section.description}</p></div>
				</div>
				<div className="section-hero-actions">{sectionKey === "events" && loaderData.canModerateEvents && <Link className="button button--secondary" to="/events/moderation"><Icon name="settings" size={17} />Moderate</Link>}{loaderData.canCreate && <Link className="button button--primary" to={`/posts/new?section=${sectionKey}`}><Icon name="plus" size={17} />{section.action}</Link>}</div>
			</section>

			<section className="panel content-filter-panel">
				<Form className="content-filter-form" method="get">
					<label>Organization<select defaultValue={filters.organizationId ?? ""} name="organization"><option value="">All visible organizations</option>{loaderData.visibleOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
					<label>Tag<select defaultValue={filters.tag ?? ""} name="tag"><option value="">All tags</option>{feed.tags.map((tag) => <option key={tag.tag} value={tag.tag}>{tag.tag} ({tag.count})</option>)}</select></label>
					<button className="button button--secondary" type="submit"><Icon name="search" size={16} /> Apply filters</button>
					{(filters.tag || filters.organizationId) && <Link className="content-clear-link" to={`/${sectionKey}`}>Clear</Link>}
				</Form>
				<p>{feed.total} {feed.total === 1 ? "post" : "posts"} visible to you</p>
			</section>

			{feed.posts.length === 0 ? (
				<section className="panel empty-state content-empty-state"><Icon name={section.icon} size={28} /><strong>No posts match this view</strong><p>{loaderData.canCreate ? "Start the conversation with the first post." : "Try another filter or check back later."}</p></section>
			) : (
				<section className="content-feed" aria-label={`${section.title} posts`}>
					{feed.posts.map((post) => (
						<article className={`panel content-card${post.section === "event" ? " event-content-card" : ""}`} key={post.id}>
							{post.eventImageUrl && <img alt="" className="event-card-image" loading="lazy" referrerPolicy="no-referrer" src={post.eventImageUrl} />}
							{post.eventStartsAt && <div className="event-date-line"><Icon name="calendar" size={17} /><strong>{formatEventDateTime(post.eventStartsAt)}</strong>{post.eventEndsAt && <span>to {formatEventDateTime(post.eventEndsAt)}</span>}{post.eventLocationName && <span>· {post.eventLocationName}</span>}</div>}
							<div className="content-card-meta">
								<span className="avatar">{(post.authorName || "Member").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span>
								<div><strong>{post.authorName || "Member"}</strong><p>{post.organizationName || "Ecosystem-wide"} · {formatDate(post.createdAt)}</p></div>
								<span className="visibility-pill">{post.visibility === "organization" ? "Organization only" : "Shared network"}</span>
							</div>
							<Link className="content-card-link" to={`/posts/${post.id}`}><h2>{post.title}</h2><p>{post.body}</p></Link>
							{post.tags.length > 0 && <div className="content-tag-row">{post.tags.map((tag) => <Link key={tag} to={pageUrl(sectionKey, 1, tag, filters.organizationId)}>#{tag}</Link>)}</div>}
							<footer><span><Icon name="message" size={15} /> {post.commentCount} comments</span><span><Icon name="heart" size={15} /> {post.supportCount} supports</span>{post.canEdit && <Link to={`/posts/${post.id}/edit`}>Edit</Link>}<Link to={`/posts/${post.id}`}>Open <Icon name="chevron-right" size={15} /></Link></footer>
						</article>
					))}
				</section>
			)}

			{feed.totalPages > 1 && <nav aria-label="Post pages" className="content-pagination">{feed.page > 1 && <Link className="button button--secondary" to={pageUrl(sectionKey, feed.page - 1, filters.tag, filters.organizationId)}>Previous</Link>}<span>Page {feed.page} of {feed.totalPages}</span>{feed.page < feed.totalPages && <Link className="button button--secondary" to={pageUrl(sectionKey, feed.page + 1, filters.tag, filters.organizationId)}>Next</Link>}</nav>}
		</div>
	);
}
