import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/section";
import { AffiliationAudiencePicker } from "~/components/affiliation-audience-picker";
import { Icon } from "~/components/icon";
import { IdentityAvatar } from "~/components/identity-avatar";
import { MentionText, MentionTextarea, type MentionTarget } from "~/components/mention-textarea";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { communityUpdateTitle, isContentSection, isEventTiming, normalizeTags, sectionDefinitions, type EventTiming } from "~/lib/content";
import { formatEventDateTime } from "~/lib/events";
import { requireSameOrigin } from "~/lib/http.server";
import { CommentMutationError, createComment, listFeedCommentPreviews } from "~/models/comments.server";
import { InteractionMutationError, listMentionableMembers, syncPostMentions } from "~/models/interactions.server";
import { listVisibleOrganizations } from "~/models/organizations.server";
import { createPost, deleteCommunityUpdate, getPostById, listAvailablePostAffiliations, listPostOrganizations, listSectionPosts, PostMutationError } from "~/models/posts.server";
import { listVisibleMembers } from "~/models/profiles.server";

const optionalOrganization = z.preprocess((value) => typeof value === "string" && value.trim() ? value.trim() : null, z.string().max(100).nullable());
const updateActionSchema = z.discriminatedUnion("intent", [
	z.object({ intent: z.literal("create-update"), body: z.string().trim().min(2, "Write a community update").max(12000), organizationId: optionalOrganization, tags: z.string().max(320) }),
	z.object({ intent: z.literal("create-feed-comment"), postId: z.string().uuid(), body: z.string().trim().min(2, "Write a comment").max(4000) }),
	z.object({ intent: z.literal("delete-update"), postId: z.string().uuid() }),
]);

function updateErrorMessage(error: PostMutationError) {
	return {
		"not-found": "That update is no longer available.",
		forbidden: "You do not have permission to post this update.",
		"organization-required": "Choose an organization for this update.",
		"organization-unavailable": "You need a contributor or organization-admin role to post for that organization.",
		"affiliation-required": "Choose at least one affiliation, or post for an organization participating in State of Queer Digital.",
		"affiliation-unavailable": "You can only tag affiliations you belong to.",
		"event-details-required": "Event details are required.",
	}[error.reason];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	if (!isContentSection(params.section)) throw new Response("Not found", { status: 404 });
	const url = new URL(request.url);
	const rawPage = Number(url.searchParams.get("page") ?? "1");
	const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000) : 1;
	const tag = url.searchParams.get("tag")?.trim().toLowerCase() || null;
	const organizationId = url.searchParams.get("organization")?.trim() || null;
	const requestedAffiliationIds = [...new Set(url.searchParams.getAll("affiliation").map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 100))].slice(0, 20);
	const affiliationIds = url.searchParams.has("affiliations") ? requestedAffiliationIds : null;
	const requestedTiming = url.searchParams.get("when");
	const eventTiming: EventTiming = params.section === "events" && isEventTiming(requestedTiming) ? requestedTiming : params.section === "events" ? "upcoming" : "all";
	const section = sectionDefinitions[params.section];
	const [feed, visibleOrganizations, authoringOrganizations, visibleMembers, availableAffiliations] = await Promise.all([
		listSectionPosts(context.cloudflare.env, user, { section: section.databaseValue, tag, organizationId, affiliationIds, eventTiming, page }),
		listVisibleOrganizations(context.cloudflare.env, user),
		listPostOrganizations(context.cloudflare.env, user),
		listVisibleMembers(context.cloudflare.env, user),
		listAvailablePostAffiliations(context.cloudflare.env, user),
	]);
	const mentionTargets: MentionTarget[] = [
		...visibleMembers.map((member) => ({ id: member.id, type: "person" as const, label: member.name || "Member", detail: member.profileTitle || member.organizationNames, href: `/members/${member.id}` })),
		...visibleOrganizations.map((organization) => ({ id: organization.id, type: "organization" as const, label: organization.name, detail: organization.summary, href: `/organizations/${organization.slug}` })),
	];
	const feedCommentPreviews = params.section === "updates"
		? await listFeedCommentPreviews(context.cloudflare.env, feed.posts.map((post) => post.id))
		: [];
	const feedMentionMemberEntries = params.section === "updates"
		? await Promise.all(feed.posts.map(async (post) => [post.id, await listMentionableMembers(context.cloudflare.env, user, post.id)] as const))
		: [];
	const commentMentionTargetsByPost = Object.fromEntries(feedMentionMemberEntries.map(([postId, members]) => [postId, [
		...members.map((member) => ({ id: member.id, type: "person" as const, label: member.name || "Member", detail: member.profileTitle || member.organizationNames, href: `/members/${member.id}` })),
		...visibleOrganizations.map((organization) => ({ id: organization.id, type: "organization" as const, label: organization.name, detail: organization.summary, href: `/organizations/${organization.slug}` })),
	]]));
	return {
		sectionKey: params.section,
		section,
		feed,
		visibleOrganizations,
		availableAffiliations,
		authoringOrganizations,
		canCreate: true,
		canDeleteUpdates: user.siteRole === "site_admin",
		canModerateEvents: user.siteRole === "site_admin" || authoringOrganizations.some((organization) => organization.role === "org_admin"),
		filters: { tag, organizationId, affiliationIds, eventTiming },
		visibleMemberIds: visibleMembers.map((member) => member.id),
		mentionTargets,
		feedCommentPreviews,
		commentMentionTargetsByPost,
	};
}

export async function action({ request, context, params }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	if (params.section !== "updates") throw new Response("Not found", { status: 404 });
	const formData = await request.formData();
	const requestedAffiliationIds = [...new Set(formData.getAll("affiliationId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const affiliationIds = formData.get("ecosystemWide") === "true" ? [] : requestedAffiliationIds;
	const mentionUserIds = [...new Set(formData.getAll("mentionUserId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const result = updateActionSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Check your update" };
	try {
		if (result.data.intent === "delete-update") {
			await deleteCommunityUpdate(context.cloudflare.env, user, result.data.postId);
			throw redirect("/updates");
		}
		if (result.data.intent === "create-update") {
			const created = await createPost(context.cloudflare.env, user, {
				organizationId: result.data.organizationId,
				section: "update",
				title: communityUpdateTitle(result.data.body),
				body: result.data.body,
				visibility: "members",
				status: "published",
				tags: normalizeTags(result.data.tags),
				affiliationIds,
			});
			await syncPostMentions(context.cloudflare.env, user, created.id, mentionUserIds);
			throw redirect(`/updates#post-${created.id}`);
		}
		const post = await getPostById(context.cloudflare.env, user, result.data.postId);
		if (!post || post.section !== "update") throw new CommentMutationError("post-unavailable");
		const created = await createComment(context.cloudflare.env, user, { postId: post.id, parentCommentId: null, body: result.data.body, mentionUserIds });
		throw redirect(`/updates#comment-${created.id}`);
	} catch (error) {
		if (error instanceof Response) throw error;
		if (error instanceof PostMutationError) return {
			ok: false as const,
			error: result.data.intent === "delete-update" && error.reason === "forbidden"
				? "Only site administrators can delete community updates."
				: updateErrorMessage(error),
		};
		if (error instanceof CommentMutationError) return { ok: false as const, error: error.reason === "post-unavailable" ? "That update is no longer available for comments." : "Your comment could not be posted." };
		if (error instanceof InteractionMutationError) return { ok: false as const, error: error.reason === "member-unavailable" ? "One of the tagged members cannot be mentioned in this conversation." : "Your update could not be posted." };
		console.error(JSON.stringify({ message: "inline update action failed", actorUserId: user.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "Your update could not be posted. Please try again." };
	}
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.section.title ?? "Workspace"} · State of Queer NH` }];
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatCommentDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function pageUrl(section: string, page: number, tag: string | null, organizationId: string | null, affiliationIds: string[] | null, eventTiming: EventTiming) {
	const search = new URLSearchParams();
	if (page > 1) search.set("page", String(page));
	if (tag) search.set("tag", tag);
	if (organizationId) search.set("organization", organizationId);
	if (affiliationIds !== null) {
		search.set("affiliations", "selected");
		for (const affiliationId of affiliationIds) search.append("affiliation", affiliationId);
	}
	if (section === "events" && eventTiming !== "upcoming") search.set("when", eventTiming);
	return `/${section}${search.size ? `?${search}` : ""}`;
}

export default function Section({ loaderData }: Route.ComponentProps) {
	const { section, sectionKey, feed, filters } = loaderData;
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submittingIntent = navigation.formData?.get("intent");
	return (
		<div className="section-page content-section-page">
			<section className="section-hero">
				<div className="section-hero-copy">
					<span className="section-hero-icon"><Icon name={section.icon} size={24} /></span>
					<div><p className="eyebrow">{section.eyebrow}</p><h1>{section.title}</h1><p>{section.description}</p></div>
				</div>
				<div className="section-hero-actions">{sectionKey === "events" && loaderData.canModerateEvents && <Link className="button button--secondary" to="/events/moderation"><Icon name="settings" size={17} />Moderate</Link>}{sectionKey !== "updates" && loaderData.canCreate && <Link className="button button--primary" to={`/posts/new?section=${sectionKey}`}><Icon name="plus" size={17} />{section.action}</Link>}</div>
			</section>

			{actionData && !actionData.ok && <p className="form-message form-message--error">{actionData.error}</p>}

			{sectionKey === "updates" && loaderData.canCreate && <details className="panel community-update-composer" id="community-update-composer">
				<summary className="community-update-composer-summary"><span><Icon name="message" size={19} /><span><strong>Post a community update</strong><small>Share news, ask a question, or celebrate a win</small></span></span><Icon className="community-update-expand-icon" name="plus" size={18} /></summary>
				<Form className="community-update-composer-form" method="post">
					<input name="intent" type="hidden" value="create-update" />
					<label className="sr-only" htmlFor="community-update-body">Community update</label>
					<MentionTextarea id="community-update-body" maxLength={12000} minLength={2} placeholder="Share news, ask a question, celebrate a win, or let the community know what’s happening… Type @ to tag." required rows={4} targets={loaderData.mentionTargets} />
					<div className="community-update-options">
						<label>Post as<select defaultValue={loaderData.authoringOrganizations[0]?.id ?? ""} name="organizationId"><option value="">Yourself · community-wide</option>{loaderData.authoringOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}{organization.directoryStatus === "published" ? " · State of Queer Digital" : ""}</option>)}</select></label>
						<label>Topics <span>(optional)</span><input maxLength={320} name="tags" placeholder="mutual-aid, celebration, question" /></label>
					</div>
					<details className="community-update-audience">
						<summary>Choose audience</summary>
						<p>Community updates default to Ecosystem-wide. Select affiliations to limit this update to those coalition spaces.</p>
						<AffiliationAudiencePicker affiliations={loaderData.availableAffiliations} />
					</details>
					<div className="community-update-composer-actions"><span>Community posts are shared with your selected audience.</span><button className="button button--primary" disabled={navigation.state === "submitting" && submittingIntent === "create-update"} type="submit">{navigation.state === "submitting" && submittingIntent === "create-update" ? "Posting…" : "Post update"}</button></div>
				</Form>
			</details>}

			<section className={`panel content-filter-panel${sectionKey === "updates" ? " content-filter-panel--community" : ""}`}>
				<Form className="content-filter-form" method="get">
					<input name="affiliations" type="hidden" value="selected" />
					{sectionKey === "events" && <label>When<select defaultValue={filters.eventTiming} name="when"><option value="upcoming">Upcoming events</option><option value="past">Past events</option><option value="all">All events</option></select></label>}
					<label>Organization<select defaultValue={filters.organizationId ?? ""} name="organization"><option value="">All visible organizations</option>{loaderData.visibleOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
					<label>Tag<select defaultValue={filters.tag ?? ""} name="tag"><option value="">All tags</option>{feed.tags.map((tag) => <option key={tag.tag} value={tag.tag}>{tag.tag} ({tag.count})</option>)}</select></label>
					{loaderData.availableAffiliations.length > 0 && <fieldset className="content-affiliation-filter"><legend>Affiliations</legend><div>{loaderData.availableAffiliations.map((affiliation) => <label key={affiliation.id}><input defaultChecked={filters.affiliationIds === null || filters.affiliationIds.includes(affiliation.id)} name="affiliation" type="checkbox" value={affiliation.id} />{affiliation.name}</label>)}</div></fieldset>}
					<button className="button button--secondary" type="submit"><Icon name="search" size={16} /> Apply filters</button>
					{(filters.tag || filters.organizationId || filters.affiliationIds !== null || (sectionKey === "events" && filters.eventTiming !== "upcoming")) && <Link className="content-clear-link" to={`/${sectionKey}`}>Clear</Link>}
				</Form>
				<p>{feed.total} {feed.total === 1 ? "post" : "posts"} visible to you</p>
			</section>

			{feed.posts.length === 0 ? (
				<section className="panel empty-state content-empty-state"><Icon name={section.icon} size={28} /><strong>No posts match this view</strong><p>{loaderData.canCreate ? "Start the conversation with the first post." : "Try another filter or check back later."}</p></section>
			) : (
				<section className={`content-feed${sectionKey === "events" ? " content-feed--events" : ""}${sectionKey === "projects" ? " content-feed--projects" : ""}`} aria-label={`${section.title} posts`}>
					{feed.posts.map((post) => {
						const commentPreviews = loaderData.feedCommentPreviews.filter((comment) => comment.postId === post.id);
						const commentMentionTargets = loaderData.commentMentionTargetsByPost[post.id] ?? [];
						return <article className={`panel content-card${post.section === "event" ? " event-content-card" : ""}${post.section === "update" ? " update-content-card" : ""}`} id={`post-${post.id}`} key={post.id}>
							{post.eventImageUrl && <img alt="" className="event-card-image" loading="lazy" referrerPolicy="no-referrer" src={post.eventImageUrl} />}
							{post.eventStartsAt && <div className="event-date-line"><Icon name="calendar" size={17} /><strong>{formatEventDateTime(post.eventStartsAt)}</strong>{post.eventEndsAt && <span>to {formatEventDateTime(post.eventEndsAt)}</span>}{post.eventLocationName && <span>· {post.eventLocationName}</span>}</div>}
							<div className="content-card-meta">
								<IdentityAvatar name={post.authorName || "Member"} objectKey={post.authorAvatarObjectKey} />
								<div>{loaderData.visibleMemberIds.includes(post.authorUserId) ? <Link className="identity-name-link" to={`/members/${post.authorUserId}`}><strong>{post.authorName || "Member"}</strong></Link> : <strong>{post.authorName || "Member"}</strong>}<p>{post.organizationName ? <Link to={`/organizations/${post.organizationSlug}`}>{post.organizationName}</Link> : "Ecosystem-wide"} · {formatDate(post.createdAt)}</p></div>
								{post.section !== "update" && <span className="visibility-pill">{post.visibility === "organization" ? "Organization only" : "Shared network"}</span>}
							</div>
							<div className="content-card-link">{post.section !== "update" && <h2><Link to={`/posts/${post.id}`}>{post.title}</Link></h2>}<MentionText targets={loaderData.mentionTargets} text={post.body} /></div>
							{post.affiliations.length > 0 && <div className="content-affiliation-row" aria-label="Affiliations">{post.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>}
							{post.tags.length > 0 && <div className="content-tag-row">{post.tags.map((tag) => <Link key={tag} to={pageUrl(sectionKey, 1, tag, filters.organizationId, filters.affiliationIds, filters.eventTiming)}>#{tag}</Link>)}</div>}
							{post.section === "update" && <section className="update-comment-preview" aria-label={`Conversation on update from ${post.authorName || "Member"}`}>
								<div className="update-comment-preview-heading"><strong>Conversation</strong>{post.commentCount > 0 && <Link to={`/posts/${post.id}#conversation`}>View all {post.commentCount}</Link>}</div>
								{commentPreviews.length > 0 && <div className="update-comment-preview-list">{commentPreviews.map((comment) => <article className="update-comment-preview-item" id={`comment-${comment.id}`} key={comment.id}><IdentityAvatar name={comment.authorName || "Member"} objectKey={comment.authorAvatarObjectKey} /><div><p><strong>{comment.authorName || "Member"}</strong><time dateTime={comment.createdAt}>{formatCommentDate(comment.createdAt)}</time></p><MentionText targets={loaderData.mentionTargets} text={comment.body} /></div></article>)}</div>}
								<Form className="update-feed-comment-form" method="post"><input name="intent" type="hidden" value="create-feed-comment" /><input name="postId" type="hidden" value={post.id} /><label className="sr-only" htmlFor={`feed-comment-${post.id}`}>Comment on this update</label><MentionTextarea id={`feed-comment-${post.id}`} maxLength={4000} minLength={2} placeholder="Write a comment… Type @ to tag." required rows={2} targets={commentMentionTargets} /><button className="button button--secondary button--compact" disabled={navigation.state === "submitting" && navigation.formData?.get("postId") === post.id} type="submit">Comment</button></Form>
							</section>}
							<footer><span><Icon name="message" size={15} /> {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</span><span><Icon name="heart" size={15} /> {post.supportCount} supports</span>{post.canEdit && <Link to={`/posts/${post.id}/edit`}>Edit</Link>}<Link to={`/posts/${post.id}`}>{post.section === "update" ? "View update" : "Open"} <Icon name="chevron-right" size={15} /></Link>{post.section === "update" && loaderData.canDeleteUpdates && <Form method="post" onSubmit={(event) => { if (!window.confirm("Permanently delete this community update and all of its comments? This cannot be undone.")) event.preventDefault(); }}><input name="intent" type="hidden" value="delete-update" /><input name="postId" type="hidden" value={post.id} /><button className="update-delete-button" disabled={navigation.state === "submitting" && navigation.formData?.get("postId") === post.id} type="submit">Delete</button></Form>}</footer>
						</article>;
					})}
				</section>
			)}

			{feed.totalPages > 1 && <nav aria-label="Post pages" className="content-pagination">{feed.page > 1 && <Link className="button button--secondary" to={pageUrl(sectionKey, feed.page - 1, filters.tag, filters.organizationId, filters.affiliationIds, filters.eventTiming)}>Previous</Link>}<span>Page {feed.page} of {feed.totalPages}</span>{feed.page < feed.totalPages && <Link className="button button--secondary" to={pageUrl(sectionKey, feed.page + 1, filters.tag, filters.organizationId, filters.affiliationIds, filters.eventTiming)}>Next</Link>}</nav>}
		</div>
	);
}
