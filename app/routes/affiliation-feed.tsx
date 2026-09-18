import { Form, Link } from "react-router";

import type { Route } from "./+types/affiliation-feed";
import { Icon } from "~/components/icon";
import { IdentityAvatar } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { formatEventDateTime } from "~/lib/events";
import { mediaUrl } from "~/lib/media";
import { listAffiliationFeedPosts, listMemberAffiliations } from "~/models/posts.server";

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const affiliations = await listMemberAffiliations(context.cloudflare.env, user);
	const url = new URL(request.url);
	const requestedSlug = url.searchParams.get("space");
	const selected = requestedSlug
		? affiliations.find((affiliation) => affiliation.slug === requestedSlug)
		: affiliations[0];
	if (requestedSlug && !selected) throw new Response("Not found", { status: 404 });
	const rawPage = Number(url.searchParams.get("page") ?? "1");
	const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000) : 1;
	const feed = selected
		? await listAffiliationFeedPosts(context.cloudflare.env, user, selected.id, page)
		: { posts: [], page: 1, total: 0, totalPages: 1 };
	return { affiliations, selected, feed };
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.selected?.name ?? "My Affiliations"} · NH Connect` }];
}

function pageUrl(slug: string, page: number) {
	const search = new URLSearchParams({ space: slug });
	if (page > 1) search.set("page", String(page));
	return `/affiliations?${search}`;
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function AffiliationFeed({ loaderData }: Route.ComponentProps) {
	const { affiliations, selected, feed } = loaderData;
	return <div className="section-page affiliation-feed-page">
		<section className="section-hero">
			<div className="section-hero-copy"><span className="section-hero-icon"><Icon name="people" size={24} /></span><div><p className="eyebrow">Your coalition spaces</p><h1>My Affiliations</h1><p>Events, projects, and community updates shared with affiliations you belong to directly or through an organization.</p></div></div>
		</section>
		{affiliations.length === 0 ? <section className="panel empty-state content-empty-state"><Icon name="people" size={28} /><strong>No affiliations yet</strong><p>When you or an organization you belong to joins an affiliation, its shared posts will appear here. You can request an affiliation from your profile.</p><Link className="button button--secondary" to="/profile">View your profile</Link></section> : <>
			<Form className="panel affiliation-space-selector" method="get">
				<div><strong>Choose an affiliation</strong><p id="affiliation-space-help">Select one of your coalition spaces to view its events, projects, and community updates.</p></div>
				<label htmlFor="affiliation-space-select">Affiliation<select aria-describedby="affiliation-space-help" defaultValue={selected?.slug} id="affiliation-space-select" key={selected?.id} name="space" onChange={(event) => event.currentTarget.form?.requestSubmit()}>{affiliations.map((affiliation) => <option key={affiliation.id} value={affiliation.slug}>{affiliation.name}</option>)}</select></label>
				<button className="button button--secondary" type="submit">View feed <Icon name="chevron-right" size={16} /></button>
			</Form>
			{selected && <>
				<div className="affiliation-feed-heading"><div><p className="eyebrow">Affiliation feed</p><h2>{selected.name}</h2><p>{feed.total} {feed.total === 1 ? "post" : "posts"} shared with this affiliation</p></div><div className="section-hero-actions"><Link className="button button--secondary" to={`/posts/new?section=events&affiliation=${encodeURIComponent(selected.slug)}`}><Icon name="calendar" size={16} />Add event</Link><Link className="button button--secondary" to={`/posts/new?section=projects&affiliation=${encodeURIComponent(selected.slug)}`}><Icon name="clipboard" size={16} />Start project</Link><Link className="button button--primary" to={`/posts/new?section=updates&affiliation=${encodeURIComponent(selected.slug)}`}><Icon name="plus" size={16} />Post update</Link></div></div>
				{feed.posts.length === 0 ? <section className="panel empty-state content-empty-state"><Icon name="message" size={28} /><strong>Nothing shared here yet</strong><p>Start a conversation, project, or event for this affiliation.</p></section> : <section aria-label={`${selected.name} posts`} className="content-feed content-feed--projects affiliation-content-feed">{feed.posts.map((post) => <article className="panel content-card affiliation-content-card" key={post.id}>
					{post.eventImageUrl && <img alt="" className="event-card-image" loading="lazy" referrerPolicy="no-referrer" src={post.eventImageUrl} />}
					<div className="content-card-meta"><IdentityAvatar name={post.authorName || "Member"} objectKey={post.authorAvatarObjectKey} /><div><strong>{post.authorName || "Member"}</strong><p>{post.organizationName || "Member post"} · {formatDate(post.createdAt)}</p></div><span className="affiliation-content-kind">{post.section === "update" ? "Update" : post.section === "event" ? "Event" : "Project"}</span></div>
					{post.eventStartsAt && <p className="event-date-line"><Icon name="calendar" size={17} /><strong>{formatEventDateTime(post.eventStartsAt)}</strong>{post.eventLocationName && <span>· {post.eventLocationName}</span>}</p>}
					<div className="content-card-link">{post.section !== "update" && <h2><Link to={`/posts/${post.id}`}>{post.title}</Link></h2>}<p>{post.body}</p></div>
					{post.imageAttachments.length > 0 && <div className="content-image-gallery">{post.imageAttachments.map((image) => <img alt={image.filename} key={image.id} loading="lazy" src={mediaUrl(image.objectKey) ?? undefined} />)}</div>}
					{post.affiliations.length > 0 && <div aria-label="Affiliations" className="content-affiliation-row">{post.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>}
					<footer><span><Icon name="message" size={15} /> {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</span><span><Icon name="heart" size={15} /> {post.supportCount} supports</span><Link to={`/posts/${post.id}`}>Open {post.section} <Icon name="chevron-right" size={15} /></Link></footer>
				</article>)}</section>}
				{feed.totalPages > 1 && <nav aria-label="Affiliation feed pages" className="content-pagination">{feed.page > 1 && <Link className="button button--secondary" to={pageUrl(selected.slug, feed.page - 1)}>Previous</Link>}<span>Page {feed.page} of {feed.totalPages}</span>{feed.page < feed.totalPages && <Link className="button button--secondary" to={pageUrl(selected.slug, feed.page + 1)}>Next</Link>}</nav>}
			</>}
		</>}
	</div>;
}
