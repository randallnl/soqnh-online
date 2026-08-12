import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/post-detail";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { routeSectionForDatabase, sectionDefinitions } from "~/lib/content";
import { archivePost, getPostById, PostMutationError } from "~/models/posts.server";

const actionSchema = z.object({ intent: z.literal("archive"), postId: z.string().uuid() });

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const post = await getPostById(context.cloudflare.env, user, params.postId);
	if (!post) throw new Response("Post not found", { status: 404 });
	return { post, section: routeSectionForDatabase(post.section) };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = actionSchema.safeParse(Object.fromEntries(await request.formData()));
	if (!result.success) return { ok: false as const, error: "That request is invalid." };
	try {
		await archivePost(context.cloudflare.env, user, result.data.postId);
		const post = await getPostById(context.cloudflare.env, user, result.data.postId);
		throw redirect(`/${post ? routeSectionForDatabase(post.section) : "updates"}`);
	} catch (error) {
		if (error instanceof Response) throw error;
		if (error instanceof PostMutationError) return { ok: false as const, error: error.reason === "forbidden" ? "You cannot archive this post." : "That post is no longer available." };
		return { ok: false as const, error: "The post could not be archived." };
	}
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.post.title ?? "Post"} · State of Queer NH` }];
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

export default function PostDetail({ loaderData }: Route.ComponentProps) {
	const { post, section } = loaderData;
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
				<footer><span><Icon name="message" size={16} /> {post.commentCount} comments</span><span><Icon name="heart" size={16} /> {post.supportCount} supports</span></footer>
			</article>
			<section className="panel content-coming-next"><Icon name="message" size={22} /><div><p className="eyebrow">Next Phase 4 slice</p><h2>Conversation and response</h2><p>Comments, replies, support reactions, and member mentions will attach to this post detail page next.</p></div></section>
			{actionData && !actionData.ok && <p className="form-message form-message--error">{actionData.error}</p>}
			{post.canEdit && post.status !== "archived" && <Form className="post-archive-form" method="post" onSubmit={(event) => { if (!window.confirm("Archive this post? It will leave the section feed.")) event.preventDefault(); }}><input name="intent" type="hidden" value="archive" /><input name="postId" type="hidden" value={post.id} /><button className="member-action-button member-action-button--suspend" disabled={navigation.state === "submitting"} type="submit">Archive post</button></Form>}
		</div>
	);
}
