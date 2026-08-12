import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/post-detail";
import { Icon } from "~/components/icon";
import { CommentThread } from "~/components/comment-thread";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { routeSectionForDatabase, sectionDefinitions } from "~/lib/content";
import { archivePost, getPostById, PostMutationError } from "~/models/posts.server";
import { archiveComment, CommentMutationError, createComment, listPostComments, updateComment } from "~/models/comments.server";
import { InteractionMutationError, listMentionableMembers, togglePostSupport } from "~/models/interactions.server";

const actionSchema = z.discriminatedUnion("intent", [
	z.object({ intent: z.literal("archive-post"), postId: z.string().uuid() }),
	z.object({ intent: z.literal("toggle-support"), postId: z.string().uuid() }),
	z.object({ intent: z.literal("create-comment"), postId: z.string().uuid(), parentCommentId: z.preprocess((value) => typeof value === "string" && value ? value : null, z.string().uuid().nullable()), mentionUserId: z.preprocess((value) => typeof value === "string" && value ? value : null, z.string().uuid().nullable()), body: z.string().trim().min(2).max(4000) }),
	z.object({ intent: z.literal("update-comment"), postId: z.string().uuid(), commentId: z.string().uuid(), body: z.string().trim().min(2).max(4000) }),
	z.object({ intent: z.literal("archive-comment"), postId: z.string().uuid(), commentId: z.string().uuid() }),
]);

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const post = await getPostById(context.cloudflare.env, user, params.postId);
	if (!post) throw new Response("Post not found", { status: 404 });
	const [comments, mentionableMembers] = await Promise.all([
		listPostComments(context.cloudflare.env, user, post.id),
		post.status === "published" ? listMentionableMembers(context.cloudflare.env, user, post.id) : Promise.resolve([]),
	]);
	return { post, comments, mentionableMembers, section: routeSectionForDatabase(post.section) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = actionSchema.safeParse(Object.fromEntries(await request.formData()));
	if (!result.success) return { ok: false as const, error: "That request is invalid." };
	if (result.data.postId !== params.postId) return { ok: false as const, error: "That request is invalid." };
	try {
		if (result.data.intent === "archive-post") {
			await archivePost(context.cloudflare.env, user, result.data.postId);
			const post = await getPostById(context.cloudflare.env, user, result.data.postId);
			throw redirect(`/${post ? routeSectionForDatabase(post.section) : "updates"}`);
		}
		if (result.data.intent === "toggle-support") {
			await togglePostSupport(context.cloudflare.env, user, result.data.postId);
			throw redirect(`/posts/${result.data.postId}`);
		}
		if (result.data.intent === "create-comment") {
			const created = await createComment(context.cloudflare.env, user, result.data);
			throw redirect(`/posts/${result.data.postId}#comment-${created.id}`);
		}
		if (result.data.intent === "update-comment") {
			await updateComment(context.cloudflare.env, user, result.data);
			throw redirect(`/posts/${result.data.postId}#comment-${result.data.commentId}`);
		}
		await archiveComment(context.cloudflare.env, user, result.data);
		throw redirect(`/posts/${result.data.postId}#conversation`);
	} catch (error) {
		if (error instanceof Response) throw error;
		if (error instanceof PostMutationError) return { ok: false as const, error: error.reason === "forbidden" ? "You cannot archive this post." : "That post is no longer available." };
		if (error instanceof CommentMutationError) {
			const messages = { "not-found": "That comment is no longer available.", forbidden: "You cannot change that comment.", "post-unavailable": "Comments are only available on published posts you can view.", "invalid-parent": "That conversation can no longer accept replies." };
			return { ok: false as const, error: messages[error.reason] };
		}
		if (error instanceof InteractionMutationError) return { ok: false as const, error: error.reason === "member-unavailable" ? "That member cannot be mentioned in this conversation." : "Interactions are only available on published posts you can view." };
		return { ok: false as const, error: "That request could not be completed." };
	}
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.post.title ?? "Post"} · State of Queer NH` }];
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

export default function PostDetail({ loaderData }: Route.ComponentProps) {
	const { post, comments, mentionableMembers, section } = loaderData;
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	return (
		<div className="post-detail-page">
			<div className="organization-detail-actions"><Link className="back-link" to={`/${section}`}>← {sectionDefinitions[section].title}</Link>{post.canEdit && <Link className="button button--secondary button--compact" to={`/posts/${post.id}/edit`}><Icon name="settings" size={16} /> Edit post</Link>}</div>
			<article className="panel post-detail-card">
				<header><div className="content-card-meta"><span className="avatar">{(post.authorName || "Member").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span><div><strong>{post.authorName || "Member"}</strong><p>{post.organizationName || "Ecosystem-wide"} · {formatDate(post.createdAt)}</p></div></div><div className="post-detail-pills"><span className={`status-pill status-pill--${post.status}`}>{post.status}</span><span className="visibility-pill">{post.visibility === "organization" ? "Organization only" : "Shared network"}</span></div></header>
				<h1>{post.title}</h1>
				<div className="post-body">{post.body.split(/\n{2,}/).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>)}</div>
				{post.tags.length > 0 && <div className="content-tag-row">{post.tags.map((tag) => <Link key={tag} to={`/${section}?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>)}</div>}
				<footer><span><Icon name="message" size={16} /> {post.commentCount} comments</span>{post.status === "published" ? <Form method="post"><input name="intent" type="hidden" value="toggle-support" /><input name="postId" type="hidden" value={post.id} /><button aria-pressed={post.viewerSupported} className={`support-button${post.viewerSupported ? " support-button--active" : ""}`} disabled={navigation.state === "submitting"} type="submit"><Icon name="heart" size={16} /> {post.viewerSupported ? "Supported" : "Support"} · {post.supportCount}</button></Form> : <span><Icon name="heart" size={16} /> {post.supportCount} supports</span>}</footer>
			</article>
			<section className="panel conversation-panel" id="conversation">
				<div className="conversation-heading"><div><p className="eyebrow">Conversation</p><h2>{post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</h2></div><Icon name="message" size={22} /></div>
				{post.status === "published" && <Form className="comment-compose-form" method="post"><input name="intent" type="hidden" value="create-comment" /><input name="postId" type="hidden" value={post.id} /><label htmlFor="new-comment">Add to the conversation</label><textarea id="new-comment" maxLength={4000} minLength={2} name="body" placeholder="Share context, a question, or a next step…" required rows={4} />{mentionableMembers.length > 0 && <label className="comment-mention-field">Notify a member<select name="mentionUserId"><option value="">No mention</option>{mentionableMembers.map((member) => <option key={member.id} value={member.id}>{member.name || "Member"}</option>)}</select></label>}<div><span>Keep comments constructive and relevant to this post.</span><button className="button button--primary" disabled={navigation.state === "submitting"} type="submit">Post comment</button></div></Form>}
				{comments.length > 0 ? <CommentThread comments={comments} interactive={post.status === "published"} mentionableMembers={mentionableMembers} postId={post.id} submitting={navigation.state === "submitting"} /> : <div className="conversation-empty"><strong>No comments yet</strong><p>Start the conversation with a question, resource, or next step.</p></div>}
			</section>
			{actionData && !actionData.ok && <p className="form-message form-message--error">{actionData.error}</p>}
			{post.canEdit && post.status !== "archived" && <Form className="post-archive-form" method="post" onSubmit={(event) => { if (!window.confirm("Archive this post? It will leave the section feed.")) event.preventDefault(); }}><input name="intent" type="hidden" value="archive-post" /><input name="postId" type="hidden" value={post.id} /><button className="member-action-button member-action-button--suspend" disabled={navigation.state === "submitting"} type="submit">Archive post</button></Form>}
		</div>
	);
}
