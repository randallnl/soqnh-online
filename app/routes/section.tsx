import { useEffect, useRef, useState } from "react";
import { Form, Link, redirect, useActionData, useFetcher, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/section";
import { AffiliationAudiencePicker } from "~/components/affiliation-audience-picker";
import { Icon } from "~/components/icon";
import { IdentityAvatar, OrganizationIdentity } from "~/components/identity-avatar";
import { MentionText, MentionTextarea, type MentionTarget } from "~/components/mention-textarea";
import { SupportButton } from "~/components/support-button";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { communityUpdateTitle, isContentSection, isEventTiming, normalizeTags, sectionDefinitions, type EventTiming } from "~/lib/content";
import { formatEventDateTime } from "~/lib/events";
import { requireSameOrigin } from "~/lib/http.server";
import { imageUploadAccept, mediaUrl, type ContentImageAttachment } from "~/lib/media";
import { deleteContentImage, ImageUploadError, requireUploadRequestSize, uploadContentImage } from "~/lib/media.server";
import { sendMentionNotificationEmails, sendSupportNotificationEmail } from "~/lib/notification-email.server";
import { ensureSubmissionId } from "~/lib/submission.client";
import { CommentMutationError, createComment, listFeedCommentPreviews } from "~/models/comments.server";
import { InteractionMutationError, listMentionableMembers, syncPostMentions, togglePostSupport } from "~/models/interactions.server";
import { listVisibleOrganizations } from "~/models/organizations.server";
import { archivePost, createPost, deleteCommunityUpdate, getPostById, listAvailablePostAffiliations, listPostOrganizations, listSectionPosts, PostMutationError } from "~/models/posts.server";
import { listVisibleMembers } from "~/models/profiles.server";
import { SubmissionInProgressError } from "~/models/submissions.server";

const optionalOrganization = z.preprocess((value) => typeof value === "string" && value.trim() ? value.trim() : null, z.string().max(100).nullable());
const optionalSubmissionId = z.preprocess((value) => typeof value === "string" && value.trim() ? value.trim() : null, z.string().uuid().nullable());
const updateActionSchema = z.discriminatedUnion("intent", [
	z.object({ intent: z.literal("archive-project"), postId: z.string().uuid() }),
	z.object({ intent: z.literal("create-update"), body: z.string().trim().min(2, "Write a community update").max(12000), organizationId: optionalOrganization, tags: z.string().max(320), submissionId: optionalSubmissionId }),
	z.object({ intent: z.literal("create-feed-comment"), postId: z.string().uuid(), body: z.string().trim().min(2, "Write a comment").max(4000), submissionId: optionalSubmissionId }),
	z.object({ intent: z.literal("toggle-support"), postId: z.string().uuid() }),
	z.object({ intent: z.literal("delete-update"), postId: z.string().uuid() }),
]);

function updateErrorMessage(error: PostMutationError) {
	return {
		"not-found": "That update is no longer available.",
		forbidden: "You do not have permission to post this update.",
		"organization-required": "Choose an organization for this update.",
		"organization-unavailable": "You need a contributor or organization-admin role to post for that organization.",
		"affiliation-required": "Choose at least one affiliation, or post for an organization participating in the NH Connect public directory.",
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
	const requestedTiming = url.searchParams.get("when");
	const eventTiming: EventTiming = params.section === "events" && isEventTiming(requestedTiming) ? requestedTiming : params.section === "events" ? "upcoming" : "all";
	const section = sectionDefinitions[params.section];
	const [feed, visibleOrganizations, authoringOrganizations, visibleMembers, availableAffiliations] = await Promise.all([
		listSectionPosts(context.cloudflare.env, user, { section: section.databaseValue, tag, organizationId, eventTiming, page }),
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
		canArchiveProjects: user.siteRole === "site_admin",
		canDeleteUpdates: user.siteRole === "site_admin",
		canModerateEvents: user.siteRole === "site_admin" || authoringOrganizations.some((organization) => organization.role === "org_admin"),
		filters: { tag, organizationId, eventTiming },
		visibleMemberIds: visibleMembers.map((member) => member.id),
		mentionTargets,
		feedCommentPreviews,
		commentMentionTargetsByPost,
	};
}

export async function action({ request, context, params }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		requireUploadRequestSize(request);
	} catch (error) {
		if (error instanceof ImageUploadError) return { ok: false as const, error: "Upload an image smaller than 10 MB." };
		throw error;
	}
	const formData = await request.formData();
	const requestedAffiliationIds = [...new Set(formData.getAll("affiliationId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const affiliationIds = formData.get("ecosystemWide") === "true" ? [] : requestedAffiliationIds;
	const mentionUserIds = [...new Set(formData.getAll("mentionUserId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const result = updateActionSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Check your update" };
	let uploadedImage: ContentImageAttachment | null = null;
	let attachmentPersisted = false;
	try {
		if (result.data.intent === "archive-project") {
			if (params.section !== "projects" || user.siteRole !== "site_admin") throw new PostMutationError("forbidden");
			const post = await getPostById(context.cloudflare.env, user, result.data.postId);
			if (!post || post.section !== "project") throw new PostMutationError("not-found");
			await archivePost(context.cloudflare.env, user, post.id);
			throw redirect("/projects");
		}
		if (params.section !== "updates") throw new Response("Not found", { status: 404 });
		if (result.data.intent === "delete-update") {
			const objectKeys = await deleteCommunityUpdate(context.cloudflare.env, user, result.data.postId);
			if (objectKeys.length > 0) context.cloudflare.ctx.waitUntil(Promise.all(objectKeys.map((key) => deleteContentImage(context.cloudflare.env, key))).then(() => undefined));
			throw redirect("/updates");
		}
		if (result.data.intent === "create-update") {
			uploadedImage = await uploadContentImage(context.cloudflare.env, formData.get("image"), user.id);
			const created = await createPost(context.cloudflare.env, user, {
				organizationId: result.data.organizationId,
				section: "update",
				title: communityUpdateTitle(result.data.body),
				body: result.data.body,
				visibility: "members",
				status: "published",
				tags: normalizeTags(result.data.tags),
				affiliationIds,
				attachment: uploadedImage,
				submissionId: result.data.submissionId,
			});
			attachmentPersisted = !created.duplicate;
			if (created.duplicate && uploadedImage) {
				await deleteContentImage(context.cloudflare.env, uploadedImage.objectKey).catch(() => undefined);
				uploadedImage = null;
			}
			if (!created.duplicate) {
				const mentions = await syncPostMentions(context.cloudflare.env, user, created.id, mentionUserIds);
				context.cloudflare.ctx.waitUntil(sendMentionNotificationEmails(context.cloudflare.env, {
					recipientIds: mentions.mentionedUserIds,
					actorName: user.name || "A member",
					kind: "update",
					postId: created.id,
				}));
			}
			return { ok: true as const, intent: "create-update" as const, postId: created.id, duplicate: created.duplicate };
		}
		if (result.data.intent === "toggle-support") {
			const post = await getPostById(context.cloudflare.env, user, result.data.postId);
			if (!post || post.section !== "update") throw new InteractionMutationError("post-unavailable");
			const toggled = await togglePostSupport(context.cloudflare.env, user, post.id);
			if (toggled.notifiedUserId) context.cloudflare.ctx.waitUntil(sendSupportNotificationEmail(context.cloudflare.env, {
				recipientId: toggled.notifiedUserId,
				actorName: user.name || "A member",
				postId: post.id,
				postTitle: toggled.postTitle,
				postKind: toggled.postKind,
			}));
			return { ok: true as const, intent: "toggle-support" as const, postId: post.id, supported: toggled.supported, supportCount: toggled.supportCount };
		}
		const post = await getPostById(context.cloudflare.env, user, result.data.postId);
		if (!post || post.section !== "update") throw new CommentMutationError("post-unavailable");
		const created = await createComment(context.cloudflare.env, user, { postId: post.id, parentCommentId: null, body: result.data.body, mentionUserIds, submissionId: result.data.submissionId });
		context.cloudflare.ctx.waitUntil(sendMentionNotificationEmails(context.cloudflare.env, {
			recipientIds: created.mentionedUserIds,
			actorName: user.name || "A member",
			kind: "comment",
			postId: post.id,
			commentId: created.id,
		}));
		return { ok: true as const, intent: "create-feed-comment" as const, postId: post.id, commentId: created.id, duplicate: created.duplicate };
	} catch (error) {
		if (error instanceof Response) throw error;
		if (uploadedImage && !attachmentPersisted) await deleteContentImage(context.cloudflare.env, uploadedImage.objectKey).catch((cleanupError) => console.error(JSON.stringify({ message: "orphaned feed image cleanup failed", objectKey: uploadedImage?.objectKey, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })));
		if (error instanceof ImageUploadError) return { ok: false as const, error: error.reason === "too-large" ? "Upload an image smaller than 10 MB." : error.reason === "unsupported" ? "Upload a PNG, JPG, WebP, or GIF image." : "The uploaded file does not appear to be a valid image." };
		if (error instanceof SubmissionInProgressError) return { ok: false as const, error: "That submission is already being processed. Please wait a moment." };
		if (error instanceof PostMutationError) return {
			ok: false as const,
			error: result.data.intent === "archive-project"
				? error.reason === "forbidden" ? "Only site administrators can archive projects." : "That project is no longer available."
				: result.data.intent === "delete-update" && error.reason === "forbidden"
				? "Only site administrators can delete community updates."
				: updateErrorMessage(error),
		};
		if (error instanceof CommentMutationError) return { ok: false as const, error: error.reason === "post-unavailable" ? "That update is no longer available for comments." : "Your comment could not be posted." };
		if (error instanceof InteractionMutationError) return { ok: false as const, error: error.reason === "member-unavailable" ? "One of the tagged members cannot be mentioned in this conversation." : result.data.intent === "toggle-support" ? "That update is no longer available to support." : "Your update could not be posted." };
		console.error(JSON.stringify({ message: "inline update action failed", actorUserId: user.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "Your update could not be posted. Please try again." };
	}
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.section.title ?? "Workspace"} · NH Connect` }];
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatCommentDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function pageUrl(section: string, page: number, tag: string | null, organizationId: string | null, eventTiming: EventTiming) {
	const search = new URLSearchParams();
	if (page > 1) search.set("page", String(page));
	if (tag) search.set("tag", tag);
	if (organizationId) search.set("organization", organizationId);
	if (section === "events" && eventTiming !== "upcoming") search.set("when", eventTiming);
	return `/${section}${search.size ? `?${search}` : ""}`;
}

function FeedCommentForm({ postId, targets }: { postId: string; targets: MentionTarget[] }) {
	const fetcher = useFetcher<typeof action>();
	const formRef = useRef<HTMLFormElement>(null);
	const handledCommentId = useRef<string | null>(null);
	const [composerKey, setComposerKey] = useState(0);
	const data = fetcher.data;

	useEffect(() => {
		if (fetcher.state !== "idle" || !data?.ok || data.intent !== "create-feed-comment" || data.commentId === handledCommentId.current) return;
		handledCommentId.current = data.commentId;
		formRef.current?.reset();
		setComposerKey((key) => key + 1);
	}, [data, fetcher.state]);

	return <fetcher.Form className="update-feed-comment-form" method="post" onSubmit={(event) => ensureSubmissionId(event.currentTarget)} ref={formRef}>
		<input name="intent" type="hidden" value="create-feed-comment" />
		<input name="postId" type="hidden" value={postId} />
		<input name="submissionId" type="hidden" />
		<label className="sr-only" htmlFor={`feed-comment-${postId}`}>Comment on this update</label>
		<MentionTextarea id={`feed-comment-${postId}`} key={composerKey} maxLength={4000} minLength={2} placeholder="Write a comment… Type @ to tag." required rows={2} targets={targets} />
		<button className="button button--secondary button--compact" disabled={fetcher.state !== "idle"} type="submit">{fetcher.state === "submitting" ? "Posting…" : "Comment"}</button>
		{data && !data.ok && <span className="form-message form-message--error" role="alert">{data.error}</span>}
		{data?.ok && fetcher.state === "idle" && <span className="form-message form-message--success" role="status">{data.duplicate ? "Comment was already posted." : "Comment posted."}</span>}
	</fetcher.Form>;
}

export default function Section({ loaderData }: Route.ComponentProps) {
	const { section, sectionKey, feed, filters } = loaderData;
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submittingIntent = navigation.formData?.get("intent");
	const updateFetcher = useFetcher<typeof action>();
	const updateFormRef = useRef<HTMLFormElement>(null);
	const handledPostId = useRef<string | null>(null);
	const [updateComposerKey, setUpdateComposerKey] = useState(0);
	const updateData = updateFetcher.data;

	useEffect(() => {
		if (updateFetcher.state !== "idle" || !updateData?.ok || updateData.intent !== "create-update" || updateData.postId === handledPostId.current) return;
		handledPostId.current = updateData.postId;
		updateFormRef.current?.reset();
		setUpdateComposerKey((key) => key + 1);
		requestAnimationFrame(() => document.getElementById(`post-${updateData.postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
	}, [updateData, updateFetcher.state]);
	return (
		<div className={`section-page content-section-page content-section-page--${sectionKey}`}>
			{updateData?.ok && updateFetcher.state === "idle" && <p className="submission-toast" role="status">{updateData.duplicate ? "That update was already posted." : "Community update posted."}</p>}
			<section className={`section-hero${sectionKey === "updates" ? " section-hero--community" : ""}`}>
				<div className="section-hero-copy">
					<span className="section-hero-icon"><Icon name={section.icon} size={24} /></span>
					<div><p className="eyebrow">{section.eyebrow}</p><h1>{section.title}</h1><p>{section.description}</p></div>
				</div>
				<div className="section-hero-actions">{sectionKey === "events" && loaderData.canModerateEvents && <Link className="button button--secondary" to="/events/moderation"><Icon name="settings" size={17} />Moderate</Link>}{sectionKey !== "updates" && loaderData.canCreate && <Link className="button button--primary" to={`/posts/new?section=${sectionKey}`}><Icon name="plus" size={17} />{section.action}</Link>}</div>
			</section>

			{actionData && !actionData.ok && <p className="form-message form-message--error">{actionData.error}</p>}

			{sectionKey === "updates" && loaderData.canCreate && <details className="panel community-update-composer" id="community-update-composer">
				<summary className="community-update-composer-summary"><span><Icon name="message" size={19} /><span><strong>Post a community update</strong><span className="community-update-composer-preview">Share news, ask a question, or celebrate a win…</span></span></span><Icon className="community-update-expand-icon" name="plus" size={18} /></summary>
				<updateFetcher.Form className="community-update-composer-form" encType="multipart/form-data" method="post" onSubmit={(event) => ensureSubmissionId(event.currentTarget)} ref={updateFormRef}>
					<input name="intent" type="hidden" value="create-update" />
					<input name="submissionId" type="hidden" />
					<label className="sr-only" htmlFor="community-update-body">Community update</label>
					<MentionTextarea id="community-update-body" key={`body-${updateComposerKey}`} maxLength={12000} minLength={2} placeholder="Share news, ask a question, celebrate a win, or let the community know what’s happening… Type @ to tag." required rows={4} targets={loaderData.mentionTargets} />
					<div className="community-update-options">
						<label>Post as<select defaultValue={loaderData.authoringOrganizations[0]?.id ?? ""} name="organizationId"><option value="">Yourself · community-wide</option>{loaderData.authoringOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}{organization.directoryStatus === "published" ? " · Public directory" : ""}</option>)}</select></label>
						<label>Topics <span>(optional)</span><input maxLength={320} name="tags" placeholder="mutual-aid, celebration, question" /></label>
					</div>
					<label className="community-image-upload">Image <span>(optional)</span><input accept={imageUploadAccept} name="image" type="file" /><small>PNG, JPG, WebP, or GIF. Maximum 10 MB.</small></label>
					<details className="community-update-audience">
						<summary>Choose audience</summary>
						<p>Community updates default to Ecosystem-wide. Select affiliations to limit this update to those coalition spaces.</p>
						<AffiliationAudiencePicker affiliations={loaderData.availableAffiliations} key={`audience-${updateComposerKey}`} />
					</details>
					<div className="community-update-composer-actions"><span>{updateFetcher.state === "submitting" ? "Uploading and posting your update…" : "Community posts are shared with your selected audience."}</span><button className="button button--primary" disabled={updateFetcher.state !== "idle"} type="submit">{updateFetcher.state === "submitting" ? "Posting update…" : "Post update"}</button></div>
					{updateData && !updateData.ok && <p className="form-message form-message--error" role="alert">{updateData.error}</p>}
				</updateFetcher.Form>
			</details>}

			<section className={`panel content-filter-panel${sectionKey === "updates" ? " content-filter-panel--community" : ""}`}>
				<Form className="content-filter-form" method="get">
					{sectionKey === "events" && <label>When<select defaultValue={filters.eventTiming} name="when"><option value="upcoming">Upcoming events</option><option value="past">Past events</option><option value="all">All events</option></select></label>}
					<label>Organization<select defaultValue={filters.organizationId ?? ""} name="organization"><option value="">All visible organizations</option>{loaderData.visibleOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
					<label>Tag<select defaultValue={filters.tag ?? ""} name="tag"><option value="">All tags</option>{feed.tags.map((tag) => <option key={tag.tag} value={tag.tag}>{tag.tag} ({tag.count})</option>)}</select></label>
					<button className="button button--secondary" type="submit"><Icon name="search" size={16} /> Apply filters</button>
					{(filters.tag || filters.organizationId || (sectionKey === "events" && filters.eventTiming !== "upcoming")) && <Link className="content-clear-link" to={`/${sectionKey}`}>Clear</Link>}
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
							{post.section === "event" ? (
								<div className="event-host-meta">
									{post.organizationName && post.organizationSlug ? (
										<Link aria-label={`View ${post.organizationName}`} className="event-host-logo-link" to={`/organizations/${post.organizationSlug}`}>
											<OrganizationIdentity logoObjectKey={post.organizationLogoObjectKey} name={post.organizationName} />
										</Link>
									) : (
										<span className="event-host-placeholder"><Icon name="building" size={21} /></span>
									)}
									<div className="event-host-copy">
										<p>Host organization</p>
										<strong>{post.organizationName && post.organizationSlug ? <Link to={`/organizations/${post.organizationSlug}`}>{post.organizationName}</Link> : "Not specified"}</strong>
										<small>{post.authorUserId === "system:event-scraper" ? "Automatically synced" : `Added by ${post.authorName || "Member"}`} · {formatDate(post.createdAt)}</small>
									</div>
								</div>
							) : (
								<div className="content-card-meta">
									<IdentityAvatar name={post.authorName || "Member"} objectKey={post.authorAvatarObjectKey} />
									<div>{loaderData.visibleMemberIds.includes(post.authorUserId) ? <Link className="identity-name-link" to={`/members/${post.authorUserId}`}><strong>{post.authorName || "Member"}</strong></Link> : <strong>{post.authorName || "Member"}</strong>}<p>{post.organizationName ? <Link to={`/organizations/${post.organizationSlug}`}>{post.organizationName}</Link> : "Ecosystem-wide"} · {formatDate(post.createdAt)}</p></div>
									{post.section !== "update" && <span className="visibility-pill">{post.visibility === "organization" ? "Organization only" : "Shared network"}</span>}
								</div>
							)}
							<div className="content-card-link">{post.section !== "update" && <h2><Link to={`/posts/${post.id}`}>{post.title}</Link></h2>}{post.section === "project" ? <div className="project-description-link"><MentionText targets={loaderData.mentionTargets} text={post.body} /><Link aria-label={`Open project: ${post.title}`} className="project-description-overlay" to={`/posts/${post.id}`} /></div> : <MentionText targets={loaderData.mentionTargets} text={post.body} />}</div>
							{post.imageAttachments.length > 0 && (post.section === "project" ? <Link aria-label={`Open project: ${post.title}`} className="content-image-gallery project-image-gallery-link" to={`/posts/${post.id}`}>{post.imageAttachments.map((image) => <img alt={image.filename} key={image.id} loading="lazy" src={mediaUrl(image.objectKey) ?? undefined} />)}</Link> : <div className="content-image-gallery">{post.imageAttachments.map((image) => <img alt={image.filename} key={image.id} loading="lazy" src={mediaUrl(image.objectKey) ?? undefined} />)}</div>)}
							{post.affiliations.length > 0 && <div className="content-affiliation-row" aria-label="Affiliations">{post.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>}
							{post.tags.length > 0 && <div className="content-tag-row">{post.tags.map((tag) => <Link key={tag} to={pageUrl(sectionKey, 1, tag, filters.organizationId, filters.eventTiming)}>#{tag}</Link>)}</div>}
							{post.section === "update" && <section className="update-comment-preview" aria-label={`Conversation on update from ${post.authorName || "Member"}`}>
								<div className="update-comment-preview-heading"><strong>Conversation</strong>{post.commentCount > 0 && <Link to={`/posts/${post.id}#conversation`}>View all {post.commentCount}</Link>}</div>
								{commentPreviews.length > 0 && <div className="update-comment-preview-list">{commentPreviews.map((comment) => <article className="update-comment-preview-item" id={`comment-${comment.id}`} key={comment.id}><IdentityAvatar name={comment.authorName || "Member"} objectKey={comment.authorAvatarObjectKey} /><div><p><strong>{comment.authorName || "Member"}</strong><time dateTime={comment.createdAt}>{formatCommentDate(comment.createdAt)}</time></p><MentionText targets={loaderData.mentionTargets} text={comment.body} />{comment.imageAttachments.map((image) => <img alt={image.filename} className="comment-image" key={image.id} loading="lazy" src={mediaUrl(image.objectKey) ?? undefined} />)}</div></article>)}</div>}
								<FeedCommentForm postId={post.id} targets={commentMentionTargets} />
							</section>}
							<footer><span><Icon name="message" size={15} /> {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</span>{post.section === "update" ? <SupportButton initialCount={post.supportCount} initialSupported={post.viewerSupported} postId={post.id} /> : <span><Icon name="heart" size={15} /> {post.supportCount} supports</span>}{post.section === "event" && <span className="visibility-pill">{post.visibility === "organization" ? "Organization only" : "Shared network"}</span>}{post.canEdit && <Link to={`/posts/${post.id}/edit`}>Edit</Link>}<Link to={`/posts/${post.id}`}>{post.section === "update" ? "View update" : "Open"} <Icon name="chevron-right" size={15} /></Link>{post.section === "project" && loaderData.canArchiveProjects && <Form method="post" onSubmit={(event) => { if (!window.confirm("Archive this project? It will leave project and affiliation feeds, but its history will be retained.")) event.preventDefault(); }}><input name="intent" type="hidden" value="archive-project" /><input name="postId" type="hidden" value={post.id} /><button className="content-card-action-button" disabled={navigation.state === "submitting" && navigation.formData?.get("postId") === post.id} type="submit">Archive</button></Form>}{post.section === "update" && loaderData.canDeleteUpdates && <Form method="post" onSubmit={(event) => { if (!window.confirm("Permanently delete this community update and all of its comments? This cannot be undone.")) event.preventDefault(); }}><input name="intent" type="hidden" value="delete-update" /><input name="postId" type="hidden" value={post.id} /><button className="update-delete-button" disabled={navigation.state === "submitting" && navigation.formData?.get("postId") === post.id} type="submit">Delete</button></Form>}</footer>
						</article>;
					})}
				</section>
			)}

			{feed.totalPages > 1 && <nav aria-label="Post pages" className="content-pagination">{feed.page > 1 && <Link className="button button--secondary" to={pageUrl(sectionKey, feed.page - 1, filters.tag, filters.organizationId, filters.eventTiming)}>Previous</Link>}<span>Page {feed.page} of {feed.totalPages}</span>{feed.page < feed.totalPages && <Link className="button button--secondary" to={pageUrl(sectionKey, feed.page + 1, filters.tag, filters.organizationId, filters.eventTiming)}>Next</Link>}</nav>}
		</div>
	);
}
